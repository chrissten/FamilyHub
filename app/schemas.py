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
