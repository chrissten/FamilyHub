"""Meal planning, and its one-directional link to the family calendar.

Kept out of app/routers/calendar.py on purpose. That file is the most load-bearing in the
app — recurrence, per-event timezones, conflict detection — and meal planning needs none
of it. Everything here writes plain, non-recurring, all-day CalendarEvent rows through
the narrowest surface that works, so planning dinner can't disturb the calendar the
family actually depends on.

**Planned meals are all-day events.** "Dinner on Tuesday" is a date, not an instant, and
treating it as all-day sidesteps timezone conversion entirely — which is where calendar
bugs live. It matches how the calendar already stores all-day events: naive midnight-to-
end-of-day, tagged UTC, never converted.

**The link tolerates being broken.** `MealPlanEntry.calendar_event_id` may point at an
event someone deleted from the calendar side. Every read here copes with that instead of
pretending two tables can be kept in lockstep.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone

from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import settings
from app.models import CalendarEvent, MealPlanEntry, Recipe, RecipeIngredient, User

MEAL_SLOTS = ("breakfast", "lunch", "dinner")
SLOT_LABELS = {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner"}

# Planned meals are prefixed with the slot ("Dinner: Chicken Parmesan") so they read as
# meals among ordinary calendar events. Deliberately plain text rather than an emoji:
# the Blotch e-ink frame widget renders these same events, and e-ink fonts routinely
# render emoji as an empty box.


def week_start(day: date_type) -> date_type:
    """Monday of the week containing `day`."""
    return day - timedelta(days=day.weekday())


def normalize_slot(value: str | None) -> str:
    slot = (value or "dinner").strip().lower()
    return slot if slot in MEAL_SLOTS else "dinner"


def _event_window(day: date_type) -> tuple[datetime, datetime]:
    """Start/end instants for an all-day event on `day`.

    Mirrors what app/routers/calendar.py does for all-day events: combine with time.min
    and time.max and tag UTC without converting, because an all-day event is a date
    boundary rather than a moment.
    """
    start = datetime.combine(day, time.min).replace(tzinfo=dt_timezone.utc)
    end = datetime.combine(day, time.max).replace(tzinfo=dt_timezone.utc)
    return start, end


def create_calendar_event(db: Session, entry: MealPlanEntry, recipe: Recipe, user: User) -> CalendarEvent:
    start, end = _event_window(entry.date)
    event = CalendarEvent(
        owner_id=user.id,
        title=f"{SLOT_LABELS[entry.meal_slot]}: {recipe.title}"[:200],
        description="Planned in Recipes",
        start_time=start,
        end_time=end,
        all_day=True,
        # All-day events still carry a timezone (see the backfill in app/main.py); they
        # just never get converted with it.
        timezone=settings.default_timezone,
    )
    # Deliberately no attendees: a planned meal is for the household, and adding
    # attendees would colour it as one person's event on the calendar.
    db.add(event)
    db.flush()
    return event


def sync_event_for(db: Session, entry: MealPlanEntry, recipe: Recipe, user: User) -> None:
    """Make the linked calendar event match the entry, creating it if it's missing.

    Covers the case where the event was deleted from the calendar: rather than erroring
    or silently losing the link, the entry gets a fresh event.
    """
    event = db.get(CalendarEvent, entry.calendar_event_id) if entry.calendar_event_id else None
    if event is None:
        event = create_calendar_event(db, entry, recipe, user)
        entry.calendar_event_id = event.id
        return
    event.title = f"{SLOT_LABELS[entry.meal_slot]}: {recipe.title}"[:200]
    event.start_time, event.end_time = _event_window(entry.date)
    event.all_day = True


def delete_entry(db: Session, entry: MealPlanEntry) -> None:
    """Remove a planned meal and the calendar event it owns.

    Only deletes an event this entry created, and only when it still exists — an event
    already removed from the calendar side is simply nothing to do.
    """
    if entry.calendar_event_id:
        event = db.get(CalendarEvent, entry.calendar_event_id)
        if event is not None:
            db.delete(event)
    db.delete(entry)


def entries_for_week(db: Session, start: date_type) -> list[MealPlanEntry]:
    end = start + timedelta(days=6)
    return (
        db.query(MealPlanEntry)
        .options(
            joinedload(MealPlanEntry.recipe).selectinload(Recipe.ingredients).joinedload(
                RecipeIngredient.ingredient
            ),
            joinedload(MealPlanEntry.added_by),
        )
        .filter(MealPlanEntry.date >= start, MealPlanEntry.date <= end)
        .order_by(MealPlanEntry.date, MealPlanEntry.meal_slot)
        .all()
    )


def week_grid(entries: list[MealPlanEntry], start: date_type) -> list[dict]:
    """Seven days, each with its three slots — the shape the planner template renders."""
    days = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        days.append({
            "date": day,
            "slots": [
                {
                    "key": slot,
                    "label": SLOT_LABELS[slot],
                    "entries": [e for e in entries if e.date == day and e.meal_slot == slot],
                }
                for slot in MEAL_SLOTS
            ],
        })
    return days


def week_shopping_lines(entries: list[MealPlanEntry]) -> list[dict]:
    """Every ingredient the week's meals need, one row per canonical ingredient.

    Combining happens by canonical ingredient rather than by recipe, so three meals that
    each want an onion produce one line. Staples and optional extras are excluded for the
    same reason they are in the recipe push: they're already in the kitchen, and a
    shopping list padded with salt is one nobody reads.
    """
    seen: dict[str, dict] = {}
    for entry in entries:
        scale = 1.0
        if entry.servings_override and entry.recipe.servings:
            scale = entry.servings_override / entry.recipe.servings
        for item in entry.recipe.ingredients:
            if item.optional:
                continue
            ingredient = item.ingredient
            if ingredient is not None and ingredient.is_staple:
                continue
            name = ingredient.name if ingredient else item.name
            key = name.lower()
            row = seen.setdefault(key, {
                "name": name,
                "category": ingredient.category if ingredient else None,
                "ingredient_ids": [],
                "recipes": [],
                "scale": scale,
            })
            row["ingredient_ids"].append(item.id)
            if entry.recipe.title not in row["recipes"]:
                row["recipes"].append(entry.recipe.title)
    return sorted(seen.values(), key=lambda r: r["name"].lower())
