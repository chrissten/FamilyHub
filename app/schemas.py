from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.config import settings


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    color_hex: str
    is_admin: bool


class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str
    color_hex: str = "#4A90D9"


class UserColorUpdate(BaseModel):
    color_hex: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class EventBase(BaseModel):
    title: str
    description: str | None = None
    location: str | None = None
    start_time: datetime
    end_time: datetime
    all_day: bool = False
    timezone: str = Field(default_factory=lambda: settings.default_timezone)
    # Zone the end time was entered in, if different from `timezone` (e.g. a flight
    # landing in another zone). None means "same as `timezone`".
    end_timezone: str | None = None
    conflict: bool = False


class EventCreate(EventBase):
    attendee_ids: list[int] = []
    recurrence: Literal["none", "weekly", "monthly"] = "none"
    recurrence_until: date | None = None


class EventOut(EventBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    owner: UserOut
    attendees: list[UserOut]
    series_id: str | None = None
    series_until: date | None = None

    @field_serializer("start_time", "end_time")
    def _ensure_utc_offset(self, dt: datetime) -> datetime:
        """SQLite hands back naive datetimes (still UTC by convention — see
        CalendarEvent.start_time); without an explicit offset, clients would parse the
        JSON string as their own local time instead of UTC. Postgres already returns
        tz-aware values, so this is a no-op there."""
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class WidgetEventOut(BaseModel):
    title: str
    location: str | None
    time_label: str
    attendees: list[str]
    all_attendees: bool


class WidgetDayOut(BaseModel):
    date: date
    label: str
    events: list[WidgetEventOut]


class WidgetEventsOut(BaseModel):
    timezone: str
    days: list[WidgetDayOut]


class WidgetGridDayOut(BaseModel):
    date: date
    weekday: str
    in_month: bool
    is_today: bool
    events: list[WidgetEventOut]


class WidgetGridOut(BaseModel):
    timezone: str
    view: Literal["week", "month"]
    weeks: list[list[WidgetGridDayOut]]


class GroceryListCreate(BaseModel):
    name: str
    is_public: bool = True


class GroceryListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_public: bool
    owner: UserOut


class CategoryCreate(BaseModel):
    name: str


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort_order: int
    list_id: int


class ItemCreate(BaseModel):
    name: str
    quantity: str | None = None
    category_id: int


class ItemUpdate(BaseModel):
    name: str
    quantity: str | None = None


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    quantity: str | None
    checked: bool
    category_id: int
    added_by: UserOut
    checked_by: UserOut | None


class TodoListCreate(BaseModel):
    name: str
    is_public: bool = True


class TodoListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_public: bool
    owner: UserOut


class TodoItemCreate(BaseModel):
    text: str


class ReorderPayload(BaseModel):
    item_ids: list[int]


class TodoItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    checked: bool
    list_id: int
    added_by: UserOut
    checked_by: UserOut | None


class FreezerCreate(BaseModel):
    name: str


class FreezerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class FreezerItemCreate(BaseModel):
    name: str
    quantity: str | None = None
    quantity_unit: Literal["oz", "lb"] | None = None
    count: int = 1
    date_purchased: date | None = None
    expiration_date: date | None = None


class FreezerItemUpdate(BaseModel):
    name: str
    quantity: str | None = None
    quantity_unit: Literal["oz", "lb"] | None = None
    count: int = 1
    date_purchased: date | None = None
    expiration_date: date | None = None


class FreezerItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    quantity: str | None
    quantity_unit: str | None
    count: int
    date_purchased: date | None
    expiration_date: date | None
    freezer_id: int
    added_by: UserOut


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str | None
    is_staple: bool


class RecipeIngredientIn(BaseModel):
    raw_text: str
    quantity: float | None = None
    unit: str | None = None
    name: str
    prep_note: str | None = None
    optional: bool = False


class RecipeIngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    raw_text: str
    quantity: float | None
    unit: str | None
    name: str
    prep_note: str | None
    optional: bool
    sort_order: int
    ingredient: IngredientOut | None


class RecipeStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    step_number: int
    text: str


class RecipeCreate(BaseModel):
    title: str
    description: str | None = None
    servings: int | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    notes: str | None = None
    source_type: Literal["manual", "url", "photo", "text"] = "manual"
    source_url: str | None = None
    source_name: str | None = None
    image_url: str | None = None
    is_public: bool = True
    # Set when the recipe came from a photo import: claims the scans stashed at
    # extraction time (see app/recipe_import.stash_scans).
    scan_token: str | None = None
    tags: list[str] = Field(default_factory=list)
    ingredients: list[RecipeIngredientIn] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)


class RecipeUpdate(RecipeCreate):
    """Same shape as create — a save replaces the ingredient and step lists wholesale
    rather than diffing them, which is what the edit form posts anyway."""


class RecipeSummaryOut(BaseModel):
    """List/card view. Deliberately omits ingredients and steps so the index page
    doesn't load every line of every recipe."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    servings: int | None
    prep_minutes: int | None
    cook_minutes: int | None
    source_type: str
    source_url: str | None
    source_name: str | None
    image_url: str | None
    is_public: bool
    owner: UserOut
    # Flattened by Recipe.tag_names / Recipe.image_ids so from_attributes can read them.
    tag_names: list[str] = Field(default_factory=list)


class RecipeOut(RecipeSummaryOut):
    notes: str | None
    ingredients: list[RecipeIngredientOut]
    steps: list[RecipeStepOut]
    image_ids: list[int] = Field(default_factory=list)


class DraftIngredientOut(BaseModel):
    """One parsed ingredient in an extracted draft. Mirrors DraftIngredient in
    app/recipe_import.py, kept separate so the schema layer doesn't drag in the
    Anthropic SDK."""

    raw_text: str
    quantity: float | None = None
    unit: str | None = None
    name: str
    canonical_name: str = ""
    prep_note: str | None = None
    optional: bool = False


class RecipeDraftOut(BaseModel):
    """An extracted, not-yet-saved recipe. The client reviews this, edits it, then POSTs
    it to /api/recipes — passing `scan_token` back so any uploaded photos get attached."""

    title: str
    description: str | None = None
    servings: int | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    tags: list[str] = Field(default_factory=list)
    ingredients: list[DraftIngredientOut] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    source_url: str | None = None
    source_name: str | None = None
    image_url: str | None = None
    scan_token: str | None = None


class ToGroceryRequest(BaseModel):
    """Push selected ingredients from a recipe onto a grocery list."""

    list_id: int
    ingredient_ids: list[int]
    # Servings multiplier applied to each ingredient's quantity. Clamped server-side.
    scale: float = 1.0


class ToGroceryResult(BaseModel):
    added: int
    merged: int
    names: list[str]
    list_id: int


class PantryItemCreate(BaseModel):
    """`name` is free text resolved to a canonical Ingredient, creating one if it's new —
    adding "harissa" to the pantry is also how recipes calling for harissa start
    matching."""

    name: str
    location: Literal["pantry", "fridge"] = "pantry"
    quantity: str | None = None


class PantryItemUpdate(BaseModel):
    quantity: str | None = None
    low: bool | None = None
    location: Literal["pantry", "fridge"] | None = None


class PantryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    location: str
    quantity: str | None
    low: bool
    ingredient: IngredientOut
    added_by: UserOut


class MatchIngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    raw_text: str
    name: str
    optional: bool
    ingredient: IngredientOut | None


class RecipeMatchOut(BaseModel):
    """One recipe ranked against what's in the kitchen."""

    recipe: RecipeSummaryOut
    have: list[MatchIngredientOut]
    missing: list[MatchIngredientOut]
    # Ingredients that never resolved to a canonical one — we can't say either way, so
    # they hold a recipe back rather than being silently assumed present.
    unknown: list[MatchIngredientOut]
    optional_missing: list[MatchIngredientOut]
    shortfall: int
    can_make: bool
    bucket: Literal["ready", "one", "several"]
