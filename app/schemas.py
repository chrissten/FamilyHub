from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


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


class EventCreate(EventBase):
    attendee_ids: list[int] = []


class EventOut(EventBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    owner: UserOut
    attendees: list[UserOut]


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
    date_purchased: date | None = None
    expiration_date: date | None = None


class FreezerItemUpdate(BaseModel):
    name: str
    quantity: str | None = None
    date_purchased: date | None = None
    expiration_date: date | None = None


class FreezerItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    quantity: str | None
    date_purchased: date | None
    expiration_date: date | None
    freezer_id: int
    added_by: UserOut
