"""Grocery list mutations shared by the grocery router and the recipe router.

These started life inside app/routers/grocery.py. They moved here when recipes needed to
add items too, so there's one definition of "what happens when you add something that's
already on the list" rather than two that drift apart.
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ingredients import format_amount, parse_ingredient_line
from app.models import GroceryCategory, GroceryItem

# Where things land when a recipe ingredient has no canonical category. Matches the
# bucket the mobile grocery screen already uses for items whose category it can't find.
DEFAULT_CATEGORY_NAME = "Other"


def sort_items_alphabetically(db: Session, category_id: int) -> None:
    items = (
        db.query(GroceryItem)
        .filter(GroceryItem.category_id == category_id)
        .order_by(func.lower(GroceryItem.name))
        .all()
    )
    for i, item in enumerate(items):
        item.sort_order = i * 10
    db.commit()


def find_existing_item(db: Session, list_id: int, name: str) -> GroceryItem | None:
    return (
        db.query(GroceryItem)
        .join(GroceryCategory)
        .filter(GroceryCategory.list_id == list_id, func.lower(GroceryItem.name) == name.strip().lower())
        .first()
    )


def get_or_create_category(db: Session, list_id: int, name: str | None) -> GroceryCategory:
    """Find a category by name within a list, creating it if it's new.

    Categories are per-list and matched by name, which is why `Ingredient.category` is
    free text rather than a foreign key. This is also what lets a recipe push work from
    the phone, where the mobile app can't create categories itself.
    """
    wanted = (name or DEFAULT_CATEGORY_NAME).strip() or DEFAULT_CATEGORY_NAME
    category = (
        db.query(GroceryCategory)
        .filter(GroceryCategory.list_id == list_id, func.lower(GroceryCategory.name) == wanted.lower())
        .first()
    )
    if category is not None:
        return category

    highest = (
        db.query(func.max(GroceryCategory.sort_order))
        .filter(GroceryCategory.list_id == list_id)
        .scalar()
    )
    category = GroceryCategory(list_id=list_id, name=wanted[:100], sort_order=(highest or 0) + 10)
    db.add(category)
    db.flush()
    return category


def merge_quantities(existing: str | None, incoming: str | None) -> str | None:
    """Combine two free-text amounts without losing either.

    Adding "1 cup" to an existing "2 cups" should give "3 cups", not silently replace it
    — pushing two recipes that both want butter is exactly the case this feature creates.
    When the units don't agree (or can't be parsed) the two are kept side by side
    ("2 cups + 1 lb") rather than one winning, because a wrong amount on a shopping list
    is worse than an ugly one.
    """
    if not existing:
        return incoming
    if not incoming:
        return existing

    left = parse_ingredient_line(existing)
    right = parse_ingredient_line(incoming)
    same_unit = (left["unit"] or "") == (right["unit"] or "")
    if left["quantity"] is not None and right["quantity"] is not None and same_unit:
        return format_amount(left["quantity"] + right["quantity"], left["unit"])

    if existing.strip().lower() == incoming.strip().lower():
        return existing
    return f"{existing} + {incoming}"


def add_or_merge_item(
    db: Session,
    list_id: int,
    *,
    name: str,
    quantity: str | None,
    category_name: str | None,
    user_id: int,
) -> tuple[GroceryItem, bool]:
    """Add an item to a list, or fold it into the matching one already there.

    Returns (item, created). An item that was already on the list and ticked off gets
    un-ticked — if you're buying it again it isn't done, which is the behaviour the
    grocery screen has always had for a re-added item.
    """
    clean_name = " ".join(name.split())[:200]
    if not clean_name:
        raise ValueError("ingredient name is empty")

    existing = find_existing_item(db, list_id, clean_name)
    if existing is not None:
        existing.quantity = merge_quantities(existing.quantity, quantity)
        if existing.checked:
            existing.checked = False
            existing.checked_by_id = None
        db.commit()
        sort_items_alphabetically(db, existing.category_id)
        return existing, False

    category = get_or_create_category(db, list_id, category_name)
    item = GroceryItem(
        name=clean_name,
        quantity=(quantity or None),
        category_id=category.id,
        added_by_id=user_id,
    )
    db.add(item)
    db.commit()
    sort_items_alphabetically(db, category.id)
    return item, True
