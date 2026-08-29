from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

event_attendees = Table(
    "event_attendees",
    Base.metadata,
    Column("event_id", ForeignKey("calendar_events.id"), primary_key=True),
    Column("user_id", ForeignKey("users.id"), primary_key=True),
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    color_hex: Mapped[str] = mapped_column(String(7), default="#4A90D9")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    events: Mapped[list["CalendarEvent"]] = relationship(back_populates="owner")


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    end_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recurrence_rule: Mapped[str | None] = mapped_column(String(200), nullable=True)
    series_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    series_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    conflict: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    owner: Mapped["User"] = relationship(back_populates="events")
    attendees: Mapped[list["User"]] = relationship(secondary=event_attendees)


class DeviceToken(Base):
    """A long-lived, revocable credential for non-interactive clients (e.g. the Blotch
    frame widget) that can't do a session/JWT login flow. Only the hash is stored;
    the raw token is shown once at creation time and never again."""

    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_prefix: Mapped[str] = mapped_column(String(8))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped["User"] = relationship()


class GroceryList(Base):
    __tablename__ = "grocery_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped["User"] = relationship()
    categories: Mapped[list["GroceryCategory"]] = relationship(
        back_populates="grocery_list", cascade="all, delete-orphan"
    )


class GroceryCategory(Base):
    __tablename__ = "grocery_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("grocery_lists.id"))
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    grocery_list: Mapped["GroceryList"] = relationship(back_populates="categories")
    items: Mapped[list["GroceryItem"]] = relationship(
        back_populates="category", cascade="all, delete-orphan", order_by="GroceryItem.sort_order"
    )


class GroceryItem(Base):
    __tablename__ = "grocery_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("grocery_categories.id"))
    name: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[str | None] = mapped_column(String(50), nullable=True)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    added_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    checked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    category: Mapped["GroceryCategory"] = relationship(back_populates="items")
    added_by: Mapped["User"] = relationship(foreign_keys=[added_by_id])
    checked_by: Mapped["User | None"] = relationship(foreign_keys=[checked_by_id])


class TodoList(Base):
    __tablename__ = "todo_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped["User"] = relationship()
    items: Mapped[list["TodoItem"]] = relationship(back_populates="todo_list", cascade="all, delete-orphan")


class TodoItem(Base):
    __tablename__ = "todo_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("todo_lists.id"))
    text: Mapped[str] = mapped_column(String(300))
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    added_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    checked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    todo_list: Mapped["TodoList"] = relationship(back_populates="items")
    added_by: Mapped["User"] = relationship(foreign_keys=[added_by_id])
    checked_by: Mapped["User | None"] = relationship(foreign_keys=[checked_by_id])


class Freezer(Base):
    __tablename__ = "freezers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    items: Mapped[list["FreezerItem"]] = relationship(
        back_populates="freezer", cascade="all, delete-orphan", order_by="FreezerItem.sort_order"
    )


class FreezerItem(Base):
    __tablename__ = "freezer_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    freezer_id: Mapped[int] = mapped_column(ForeignKey("freezers.id"))
    name: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[str | None] = mapped_column(String(50), nullable=True)
    quantity_unit: Mapped[str | None] = mapped_column(String(10), nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    date_purchased: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    added_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    freezer: Mapped["Freezer"] = relationship(back_populates="items")
    added_by: Mapped["User"] = relationship(foreign_keys=[added_by_id])
