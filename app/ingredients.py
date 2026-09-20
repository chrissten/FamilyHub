"""Canonical ingredient resolution and quantity parsing.

The whole Recipes feature hangs on one question: are "2 lbs boneless skinless chicken
breasts", a freezer package called "Chicken Breasts", and a pantry entry called "chicken
breast" the same thing? This module answers it by reducing every name to a `norm_key`
and looking that up in the `ingredients` table (with `ingredient_aliases` as a second
chance).

The normalizer is deliberately conservative. It strips words that describe *preparation*
("chopped", "fresh", "boneless") and never strips words that describe *variety*
("ground", "green", "heavy", "dried"), because "ground beef" is not "beef" and "heavy
cream" is not "cream". When in doubt a word stays: a missed match shows up as a
recipe you can't quite make yet, while a wrong match silently tells you that you have
something you don't.
"""

from __future__ import annotations

import re
import unicodedata
from fractions import Fraction

from sqlalchemy.orm import Session

from app.models import Ingredient, IngredientAlias

# Words describing how an ingredient was prepared or graded, not what it is.
# Removing these makes "3 large ripe tomatoes, chopped" and "tomato" the same key.
_PREP_WORDS = {
    "chopped", "diced", "minced", "sliced", "shredded", "grated", "crushed", "cubed",
    "halved", "quartered", "peeled", "seeded", "deseeded", "cored", "trimmed", "rinsed",
    "drained", "melted", "softened", "beaten", "divided", "packed", "heaping", "level",
    "thinly", "finely", "coarsely", "roughly", "freshly", "fresh", "large", "small",
    "medium", "jumbo", "ripe", "organic", "boneless", "skinless", "uncooked", "raw",
    "optional", "cold", "warm", "lukewarm", "approximately", "about", "good", "quality",
}

# Deliberately NOT stripped, for the reasons in the module docstring:
# ground, whole, green, red, white, black, brown, heavy, sour, sweet, dry, dried, hot,
# sharp, light, dark, wild, baby, plain, unsalted, salted, all-purpose, extra-virgin.

_ARTICLES = {"a", "an", "the", "of", "or", "and"}

# Measurement words that can survive into a name when parsing is imperfect
# ("cups flour" -> "flour").
_UNIT_WORDS = {
    "cup", "cups", "c", "tablespoon", "tablespoons", "tbsp", "tbs", "t",
    "teaspoon", "teaspoons", "tsp", "ounce", "ounces", "oz", "pound", "pounds", "lb",
    "lbs", "gram", "grams", "g", "kilogram", "kilograms", "kg", "milliliter",
    "milliliters", "ml", "liter", "liters", "l", "pint", "pints", "quart", "quarts",
    "gallon", "gallons", "pinch", "pinches", "dash", "dashes", "can", "cans", "jar",
    "jars", "package", "packages", "pkg", "bag", "bags", "box", "boxes", "clove",
    "cloves", "slice", "slices", "stick", "sticks", "bunch", "bunches", "head", "heads",
    "sprig", "sprigs", "stalk", "stalks", "piece", "pieces",
}

_IRREGULAR_PLURALS = {
    "leaves": "leaf",
    "loaves": "loaf",
    "halves": "half",
    "knives": "knife",
    "calves": "calf",
    "shelves": "shelf",
    "geese": "goose",
    "feet": "foot",
    "teeth": "tooth",
    "children": "child",
}

# Mass nouns and words that merely look plural. Ordinary plurals must NOT be listed
# here: "beans" has to reduce to "bean" or a recipe's "black beans" never matches the
# pantry's "black bean". "grounds" stays so coffee grounds don't collide with "ground".
_NEVER_SINGULARIZE = {
    "molasses", "asparagus", "hummus", "couscous", "swiss", "bass", "watercress",
    "brussels", "grits", "oats", "greens", "grounds",
}

_VULGAR_FRACTIONS = {
    "¼": "1/4", "½": "1/2", "¾": "3/4", "⅓": "1/3",
    "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8",
    "⅞": "7/8", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5",
    "⅘": "4/5", "⅙": "1/6", "⅚": "5/6",
}

_NUMBER_WORDS = {
    "one": 1.0, "two": 2.0, "three": 3.0, "four": 4.0, "five": 5.0, "six": 6.0,
    "seven": 7.0, "eight": 8.0, "nine": 9.0, "ten": 10.0, "eleven": 11.0,
    "twelve": 12.0, "dozen": 12.0, "half": 0.5, "quarter": 0.25,
}


def expand_fractions(text: str) -> str:
    """Turn "1½" into "1 1/2" so the rest of the parsing sees plain ASCII.

    Must run *before* any `unicodedata.normalize("NFKD", ...)` call: NFKD decomposes
    U+00BD into "1<U+2044>2", which would turn "1½" into "11/2" and parse as eleven.
    """
    out = []
    for ch in text:
        if ch in _VULGAR_FRACTIONS:
            # "1½" needs a separating space; "1 ½" already has one.
            if out and out[-1].isdigit():
                out.append(" ")
            out.append(_VULGAR_FRACTIONS[ch])
        elif ch == "⁄":  # FRACTION SLASH, from already-decomposed input
            out.append("/")
        else:
            out.append(ch)
    return "".join(out)


def _singularize(word: str) -> str:
    if len(word) <= 3 or word in _NEVER_SINGULARIZE:
        return word
    if word in _IRREGULAR_PLURALS:
        return _IRREGULAR_PLURALS[word]
    # "molasses", "asparagus", "basis" — plural-looking endings that aren't plurals.
    if word.endswith(("ss", "us", "is")):
        return word
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith(("oes", "ches", "shes", "xes", "zes")):
        return word[:-2]
    if word.endswith("s"):
        return word[:-1]
    return word


def normalize(name: str) -> str:
    """Reduce an ingredient name to its matching key.

    >>> normalize("3 large ripe Tomatoes, chopped")
    'tomato'
    >>> normalize("boneless, skinless chicken breasts")
    'chicken breast'
    >>> normalize("Ground Beef")
    'ground beef'
    """
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", expand_fractions(name)).lower()
    # Drop parentheticals wholesale — they're almost always asides like
    # "(about 2 medium)" or "(plus more for greasing)".
    text = re.sub(r"\([^)]*\)", " ", text)
    # Anything after a comma is prep instruction ("tomatoes, seeded and chopped").
    text = text.split(",")[0]
    # Keep hyphens as spaces so "extra-virgin" and "extra virgin" agree.
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\d+\s*/\s*\d+|\d+(?:\.\d+)?", " ", text)

    words = []
    for word in text.split():
        if word in _PREP_WORDS or word in _ARTICLES or word in _UNIT_WORDS:
            continue
        if word in _NUMBER_WORDS:
            continue
        words.append(_singularize(word))

    # Everything was a modifier ("fresh chopped") — fall back to the bare lowercased
    # name so we produce *some* key rather than an empty one.
    if not words:
        return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", name.lower())).strip()
    return " ".join(words)


def resolve(
    db: Session,
    name: str,
    *,
    create: bool = False,
    category: str | None = None,
    is_staple: bool = False,
) -> Ingredient | None:
    """Find the canonical Ingredient for a free-text name.

    Exact `norm_key` first, then the alias table. There is deliberately no fuzzy or
    partial matching: dropping words until something matches turns "italian sausage
    link" into "link" and quietly poisons the pantry.

    With `create=True` an unknown name becomes a new Ingredient (flushed, not committed —
    the caller owns the transaction).
    """
    key = normalize(name)
    if not key:
        return None

    ingredient = db.query(Ingredient).filter(Ingredient.norm_key == key).first()
    if ingredient is not None:
        return ingredient

    alias = db.query(IngredientAlias).filter(IngredientAlias.norm_key == key).first()
    if alias is not None:
        return alias.ingredient

    if not create:
        return None

    ingredient = Ingredient(
        name=name.strip()[:120] or key,
        norm_key=key,
        category=category,
        is_staple=is_staple,
    )
    db.add(ingredient)
    db.flush()
    return ingredient


def parse_quantity(text: str) -> float | None:
    """Pull a leading amount out of an ingredient line.

    Handles "2", "1.5", "1/2", "1 1/2", "1½", "one", and ranges like "1-2" (takes the
    low end, which is what you'd shop for). Returns None when there's no number, which
    is correct for things like "salt to taste".
    """
    if not text:
        return None
    cleaned = unicodedata.normalize("NFKD", expand_fractions(text)).strip().lower()

    # Range: "1-2 cups" / "1 to 2 cups" -> 1
    range_match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*\d+(?:\.\d+)?", cleaned)
    if range_match:
        return float(range_match.group(1))

    # Mixed number: "1 1/2"
    mixed = re.match(r"^\s*(\d+)\s+(\d+)\s*/\s*(\d+)", cleaned)
    if mixed:
        whole, num, den = (int(g) for g in mixed.groups())
        if den:
            return whole + num / den
        return float(whole)

    fraction = re.match(r"^\s*(\d+)\s*/\s*(\d+)", cleaned)
    if fraction:
        num, den = (int(g) for g in fraction.groups())
        return num / den if den else None

    plain = re.match(r"^\s*(\d+(?:\.\d+)?)", cleaned)
    if plain:
        return float(plain.group(1))

    first_word = cleaned.split()[0] if cleaned.split() else ""
    return _NUMBER_WORDS.get(first_word)


def format_quantity(value: float | None) -> str:
    """Render an amount the way a recipe would write it: 0.5 -> "1/2", 1.5 -> "1 1/2".

    Scaling a recipe by 1.5 produces numbers like 0.7499999; anything that lands close
    to a kitchen-sensible fraction (halves through eighths) is snapped to it, and
    anything else falls back to a short decimal.
    """
    if value is None:
        return ""
    if abs(value - round(value)) < 0.01:
        return str(int(round(value)))

    fraction = Fraction(value).limit_denominator(8)
    if abs(float(fraction) - value) < 0.02 and fraction.denominator in (2, 3, 4, 5, 6, 8):
        whole, remainder = divmod(fraction.numerator, fraction.denominator)
        if whole:
            return f"{whole} {remainder}/{fraction.denominator}"
        return f"{remainder}/{fraction.denominator}"

    return f"{value:.2f}".rstrip("0").rstrip(".")


# Short forms and plurals collapsed to one spelling, so "2 tbsp" and "2 Tablespoons"
# scale and display identically.
_UNIT_CANONICAL = {
    "c": "cup", "cup": "cup", "cups": "cup",
    "tbsp": "tablespoon", "tbs": "tablespoon", "tablespoon": "tablespoon",
    "tablespoons": "tablespoon", "t": "teaspoon", "tsp": "teaspoon",
    "teaspoon": "teaspoon", "teaspoons": "teaspoon",
    "oz": "ounce", "ounce": "ounce", "ounces": "ounce",
    "lb": "pound", "lbs": "pound", "pound": "pound", "pounds": "pound",
    "g": "gram", "gram": "gram", "grams": "gram",
    "kg": "kilogram", "kilogram": "kilogram", "kilograms": "kilogram",
    "ml": "milliliter", "milliliter": "milliliter", "milliliters": "milliliter",
    "l": "liter", "liter": "liter", "liters": "liter",
    "pint": "pint", "pints": "pint", "quart": "quart", "quarts": "quart",
    "gallon": "gallon", "gallons": "gallon",
    "pinch": "pinch", "pinches": "pinch", "dash": "dash", "dashes": "dash",
    "can": "can", "cans": "can", "jar": "jar", "jars": "jar",
    "package": "package", "packages": "package", "pkg": "package",
    "bag": "bag", "bags": "bag", "box": "box", "boxes": "box",
    "clove": "clove", "cloves": "clove", "slice": "slice", "slices": "slice",
    "stick": "stick", "sticks": "stick", "bunch": "bunch", "bunches": "bunch",
    "head": "head", "heads": "head", "sprig": "sprig", "sprigs": "sprig",
    "stalk": "stalk", "stalks": "stalk", "piece": "piece", "pieces": "piece",
}

# Recipe sites prefix ingredient lines with bullets or checkboxes, and those come along
# when you paste. Left in place they hide the quantity from _LEADING_AMOUNT below, so
# "2 cups flour" parses but "▢ 2 cups flour" silently loses both quantity and unit.
# A numbered marker only counts when the digits are followed by "." or ")" AND a space,
# so "1. 2 tbsp oil" drops the list number while "1.5 cups" keeps its amount.
_LIST_MARKER = re.compile(r"^\s*(?:[-–—*·•‣⁃▪▫◦●○▢▣☐☑✓✔]+|\d{1,2}[.)](?=\s))\s*")

_LEADING_AMOUNT = re.compile(
    r"^\s*(?:"
    r"\d+\s*(?:-|–|to)\s*\d+(?:\.\d+)?"   # 1-2
    r"|\d+\s+\d+\s*/\s*\d+"               # 1 1/2
    r"|\d+\s*/\s*\d+"                     # 1/2
    r"|\d+(?:\.\d+)?"                     # 2 or 1.5
    r")\s*"
)


def parse_ingredient_line(line: str) -> dict:
    """Split one written ingredient line into its parts.

    "2 cups all-purpose flour, sifted" becomes quantity 2.0, unit "cup", name
    "all-purpose flour", prep_note "sifted". The original text is returned as `raw_text`
    and is what gets shown to the cook — parsing only feeds matching and scaling, so a
    line this can't make sense of still survives intact with a null quantity.
    """
    raw = " ".join(line.split())
    raw = _LIST_MARKER.sub("", raw)
    working = expand_fractions(raw)
    # "1 (14.5 oz) can diced tomatoes" — the parenthetical is packaging trivia that would
    # otherwise end up in the displayed name and hide the unit behind it.
    working = " ".join(re.sub(r"\([^)]*\)", " ", working).split())

    quantity = parse_quantity(working)
    match = _LEADING_AMOUNT.match(working)
    if match and quantity is not None:
        working = working[match.end():]
    elif quantity is not None:
        # A spelled-out number like "one onion".
        first, _, rest = working.partition(" ")
        if first.lower() in _NUMBER_WORDS:
            working = rest

    unit = None
    parts = working.split()
    if parts:
        candidate = parts[0].lower().strip(".")
        if candidate in _UNIT_CANONICAL:
            unit = _UNIT_CANONICAL[candidate]
            working = " ".join(parts[1:])

    name, _, prep_note = working.partition(",")
    # "basil for garnish" / "butter for greasing the pan" — a serving instruction, not
    # part of what the ingredient is.
    name = re.sub(r"\s+for\s+.*$", "", name, flags=re.IGNORECASE).strip(" .")
    prep_note = prep_note.strip(" .") or None

    lowered = raw.lower()
    optional = "optional" in lowered or "to taste" in lowered

    return {
        "raw_text": raw[:300],
        "quantity": quantity,
        "unit": unit,
        "name": (name or raw)[:200],
        "prep_note": prep_note[:200] if prep_note else None,
        "optional": optional,
    }


def scaled_amount(quantity: float | None, unit: str | None, factor: float = 1.0) -> str:
    """The display amount for an ingredient at a given scale, e.g. "1 1/2 cups"."""
    if quantity is None:
        return unit or ""
    amount = format_quantity(quantity * factor)
    if not unit:
        return amount
    return f"{amount} {unit}".strip()
