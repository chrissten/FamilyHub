"""Answering "what can I cook tonight?" from what's actually in the kitchen.

On-hand is the union of three things: the pantry (what you ticked in), the freezer (its
items resolved through the same canonical ingredient table), and staples — salt, oil,
flour — which are assumed present so a recipe isn't reported as unmakeable over a pinch
of salt.

Two deliberate choices about honesty:

**An ingredient we couldn't resolve counts against the recipe.** If a line never matched
a canonical ingredient, we genuinely don't know whether you have it, and claiming you can
cook something you can't is the failure worth avoiding. Those surface in their own bucket
so you can see *why* a recipe isn't showing as ready, rather than it silently ranking low.

**Optional ingredients never count as missing.** A garnish or a "to taste" item shouldn't
stand between you and dinner.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session, joinedload, selectinload

from app.ingredients import normalize
from app.models import (
    FreezerItem,
    Ingredient,
    IngredientAlias,
    PantryItem,
    Recipe,
    RecipeIngredient,
)


def ingredient_key_map(db: Session) -> dict[str, int]:
    """norm_key -> ingredient id, including aliases.

    Built in two queries and used to resolve a whole list of free-text names at once.
    The ingredient table is small (a few hundred rows), so pulling it whole beats one
    lookup per freezer item.
    """
    mapping = {key: ing_id for ing_id, key in db.query(Ingredient.id, Ingredient.norm_key)}
    for ing_id, key in db.query(IngredientAlias.ingredient_id, IngredientAlias.norm_key):
        # A real ingredient always wins over an alias with the same key.
        mapping.setdefault(key, ing_id)
    return mapping


@dataclass
class OnHand:
    """Which canonical ingredients are available, and where each came from — the source
    is what lets the UI explain *why* something counts as on hand."""

    ids: set[int] = field(default_factory=set)
    sources: dict[int, str] = field(default_factory=dict)

    def add(self, ingredient_id: int, source: str) -> None:
        self.ids.add(ingredient_id)
        # Pantry and freezer are more informative than "assumed staple", so don't let a
        # staple flag overwrite a real sighting.
        if source != "staple" or ingredient_id not in self.sources:
            self.sources[ingredient_id] = source


def on_hand(db: Session) -> OnHand:
    result = OnHand()

    for (ingredient_id,) in db.query(PantryItem.ingredient_id).distinct():
        if ingredient_id is not None:
            result.add(ingredient_id, "pantry")

    # Freezer items keep their own free-text names — they were never migrated onto the
    # ingredient table — so they're resolved here at match time instead.
    key_map = ingredient_key_map(db)
    for (name,) in db.query(FreezerItem.name).distinct():
        ingredient_id = key_map.get(normalize(name or ""))
        if ingredient_id is not None:
            result.add(ingredient_id, "freezer")

    for (ingredient_id,) in db.query(Ingredient.id).filter(Ingredient.is_staple.is_(True)):
        result.add(ingredient_id, "staple")

    return result


@dataclass
class RecipeMatch:
    recipe: Recipe
    have: list[RecipeIngredient] = field(default_factory=list)
    missing: list[RecipeIngredient] = field(default_factory=list)
    # Ingredients that never resolved to a canonical one: we can't say either way.
    unknown: list[RecipeIngredient] = field(default_factory=list)
    optional_missing: list[RecipeIngredient] = field(default_factory=list)

    @property
    def shortfall(self) -> int:
        """How many things stand between you and cooking this."""
        return len(self.missing) + len(self.unknown)

    @property
    def can_make(self) -> bool:
        return self.shortfall == 0

    @property
    def considered(self) -> int:
        return len(self.have) + len(self.missing) + len(self.unknown)

    @property
    def ratio(self) -> float:
        return len(self.have) / self.considered if self.considered else 0.0

    @property
    def bucket(self) -> str:
        if self.can_make:
            return "ready"
        if self.shortfall == 1:
            return "one"
        return "several"


def match_recipe(recipe: Recipe, available: OnHand) -> RecipeMatch:
    match = RecipeMatch(recipe=recipe)
    for item in recipe.ingredients:
        if item.ingredient_id is None:
            # Optional and unrecognised: not worth holding a recipe back for a garnish
            # we also can't identify.
            (match.optional_missing if item.optional else match.unknown).append(item)
            continue
        if item.ingredient_id in available.ids:
            match.have.append(item)
        elif item.optional:
            match.optional_missing.append(item)
        else:
            match.missing.append(item)
    return match


def rank_recipes(
    db: Session,
    user,
    *,
    max_missing: int | None = None,
    q: str | None = None,
) -> tuple[list[RecipeMatch], OnHand]:
    """Every visible recipe, closest to cookable first.

    Sorted by how many ingredients you're short, then by the proportion you already have,
    then by title — so "missing 1 of 5" outranks "missing 1 of 20", which is the one
    you're more likely to actually cook.
    """
    from app.routers.recipes import visible_recipes_query  # local: avoids a router cycle

    available = on_hand(db)
    query = visible_recipes_query(db, user).options(
        joinedload(Recipe.owner),
        selectinload(Recipe.tags),
        selectinload(Recipe.ingredients).joinedload(RecipeIngredient.ingredient),
    )
    if q:
        needle = f"%{q.strip().lower()}%"
        from sqlalchemy import func

        query = query.filter(func.lower(Recipe.title).like(needle))

    matches = [match_recipe(recipe, available) for recipe in query.all()]
    if max_missing is not None:
        matches = [m for m in matches if m.shortfall <= max_missing]

    matches.sort(key=lambda m: (m.shortfall, -m.ratio, m.recipe.title.lower()))
    return matches, available


def pantry_rows(db: Session) -> list[PantryItem]:
    return (
        db.query(PantryItem)
        .options(joinedload(PantryItem.ingredient), joinedload(PantryItem.added_by))
        .join(Ingredient)
        .order_by(PantryItem.location, Ingredient.name)
        .all()
    )
