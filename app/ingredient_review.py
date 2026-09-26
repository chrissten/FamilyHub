"""Catching near-duplicate ingredients, and folding them together once someone says so.

`resolve(create=True)` turns any name it doesn't recognise into a brand new ingredient,
which is how "gran. sugar" from a recipe card ended up as its own row -- uncategorised,
not a staple, and never matching the "Sugar" already on the grocery list.

The normalizer stays strict on purpose (see app/ingredients.py): guessing that
"cake flour" is "all purpose flour" would quietly put the wrong thing in the cart. So
this module only *suggests*. A person confirms "same thing" once, the stray is merged
into the real ingredient and its name becomes an alias, and every future recipe using
that spelling resolves correctly. "Keep separate" is remembered too, so nobody gets
asked twice.
"""

from __future__ import annotations

import difflib
import re

from sqlalchemy.orm import Session

from app.ingredients import normalize
from app.models import (
    GroceryCategory,
    GroceryItem,
    Ingredient,
    IngredientAlias,
    PantryItem,
    RecipeIngredient,
)
from app.recipe_match import ingredient_key_map

# Whole-name spelling similarity needed before a typo counts as a suggestion
# ("tumeric" -> "turmeric" is 0.93; "red wine" vs "red wing" would also pass, which is
# fine for something a person has to confirm).
_FUZZY_CUTOFF = 0.85


def needs_review(ingredient: Ingredient | None) -> bool:
    """Created on the fly from a recipe or pantry entry, and nobody has looked at it yet.
    Seeded ingredients always have a category, so this is exactly the auto-created ones."""
    return ingredient is not None and ingredient.category is None and not ingredient.reviewed


def suggest_match(
    db: Session,
    ingredient: Ingredient,
    key_map: dict[str, int] | None = None,
) -> Ingredient | None:
    """The established ingredient this one is most likely a variant of, if any.

    Two tests, in order:

    1. A known name whose words all appear in this one *and* which ends in the same
       word -- English puts the thing itself last, so "gran sugar" -> "sugar" and
       "sharp cheddar cheese" -> "cheddar cheese", but "sugar snap pea" never becomes
       "sugar". The longest such name wins ("ground black pepper" -> "black pepper",
       not "pepper").
    2. Otherwise a close spelling of a whole known name ("tumeric" -> "turmeric").

    Only established ingredients (categorised, or already reviewed) are candidates, so
    one stray is never suggested as the home for another.
    """
    key_map = key_map if key_map is not None else ingredient_key_map(db)
    established = {
        ing.id: ing
        for ing in db.query(Ingredient).filter(Ingredient.id != ingredient.id)
        if ing.category is not None or ing.reviewed
    }
    words = ingredient.norm_key.split()
    if not words:
        return None

    best: tuple[int, Ingredient] | None = None
    for key, ing_id in key_map.items():
        target = established.get(ing_id)
        candidate_words = key.split()
        if target is None or not candidate_words or len(candidate_words) >= len(words):
            continue
        if candidate_words[-1] != words[-1] or not set(candidate_words) <= set(words):
            continue
        if best is None or len(candidate_words) > best[0]:
            best = (len(candidate_words), target)
    if best is not None:
        return best[1]

    keys = [key for key, ing_id in key_map.items() if ing_id in established]
    close = difflib.get_close_matches(ingredient.norm_key, keys, n=1, cutoff=_FUZZY_CUTOFF)
    if close:
        return established[key_map[close[0]]]
    return None


def merge_ingredient(db: Session, source: Ingredient, target: Ingredient) -> None:
    """Fold `source` into `target`: every recipe line and pantry entry moves over, and
    `source`'s name becomes an alias so the same spelling resolves to `target` from now
    on. Commits.
    """
    if source.id == target.id:
        return

    db.query(RecipeIngredient).filter(RecipeIngredient.ingredient_id == source.id).update(
        {RecipeIngredient.ingredient_id: target.id}, synchronize_session=False
    )

    target_locations = {
        location
        for (location,) in db.query(PantryItem.location).filter(PantryItem.ingredient_id == target.id)
    }
    for item in db.query(PantryItem).filter(PantryItem.ingredient_id == source.id).all():
        # One row per ingredient per location: if the target is already on that shelf,
        # the stray's entry is just a duplicate of it.
        if item.location in target_locations:
            db.delete(item)
        else:
            item.ingredient_id = target.id

    # Reassign through the relationship, not the column: the aliases collection has
    # delete-orphan cascade, and deleting `source` would otherwise take them with it.
    for alias in list(source.aliases):
        alias.ingredient = target

    source_key = source.norm_key
    if source.is_staple:
        target.is_staple = True
    db.delete(source)
    db.flush()

    if db.query(IngredientAlias).filter(IngredientAlias.norm_key == source_key).first() is None:
        db.add(IngredientAlias(ingredient_id=target.id, norm_key=source_key))
    db.commit()


def keep_separate(db: Session, ingredient: Ingredient) -> None:
    ingredient.reviewed = True
    db.commit()


_PARENTHETICAL = re.compile(r"^(.*?)\(([^)]*)\)(.*)$")


def grocery_name_keys(name: str) -> list[str]:
    """Candidate keys for a hand-typed grocery item, most specific first.

    People write variety in brackets on a list -- "Sugar (Powdered)" -- where
    `normalize` would throw the bracket away and match plain sugar. So try the bracket
    folded in front first ("powdered sugar"), then the name without it ("Flour
    (unbleached)" still finds flour).
    """
    keys = []
    match = _PARENTHETICAL.match(name or "")
    if match:
        keys.append(normalize(f"{match.group(2)} {match.group(1)} {match.group(3)}"))
    keys.append(normalize(name or ""))
    return [key for key in keys if key]


def resolve_grocery_name(name: str, key_map: dict[str, int]) -> int | None:
    for key in grocery_name_keys(name):
        if key in key_map:
            return key_map[key]
    return None


def list_items_by_ingredient(
    db: Session,
    list_ids: list[int],
    key_map: dict[str, int],
    *,
    include_checked: bool = False,
) -> dict[int, dict[int, GroceryItem]]:
    """{list_id: {ingredient_id: item}} -- what's on each list by what it *is* rather
    than how it was spelled. Unticked items win when both exist."""
    result: dict[int, dict[int, GroceryItem]] = {list_id: {} for list_id in list_ids}
    if not list_ids:
        return result
    query = (
        db.query(GroceryItem, GroceryCategory.list_id)
        .join(GroceryCategory)
        .filter(GroceryCategory.list_id.in_(list_ids))
        .order_by(GroceryItem.checked, GroceryItem.id)
    )
    if not include_checked:
        query = query.filter(GroceryItem.checked.is_(False))
    rows = query.all()
    for item, list_id in rows:
        ingredient_id = resolve_grocery_name(item.name, key_map)
        if ingredient_id is not None:
            result[list_id].setdefault(ingredient_id, item)
    return result
