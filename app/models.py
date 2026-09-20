from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Table,
    Text,
    UniqueConstraint,
)
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


recipe_tags = Table(
    "recipe_tags",
    Base.metadata,
    Column("recipe_id", ForeignKey("recipes.id"), primary_key=True),
    Column("tag_id", ForeignKey("recipe_tag_names.id"), primary_key=True),
)


class Ingredient(Base):
    """A canonical ingredient, shared across the whole household.

    This is the join point that makes recipe matching work at all: a recipe calling for
    "2 lbs boneless skinless chicken breasts", a freezer package named "chicken breasts",
    and a pantry entry called "Chicken Breast" all resolve to the same row here via
    `norm_key` (see app/ingredients.py). Grocery and freezer items keep matching on their
    own raw names as they always have -- nothing existing changes -- they're only resolved
    through this table when a recipe asks "do we have this?".
    """

    __tablename__ = "ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    norm_key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    # Grocery category name to file this under when pushed to a list ("Produce", "Meat").
    # Free text rather than an FK: grocery categories are per-list, so this is matched by
    # name and created on demand.
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Salt, pepper, water, cooking oil: assumed to be in the house, so they never count
    # as "missing" when ranking what you can cook tonight.
    is_staple: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    aliases: Mapped[list["IngredientAlias"]] = relationship(
        back_populates="ingredient", cascade="all, delete-orphan"
    )


class IngredientAlias(Base):
    """Another name for the same thing -- "scallion" for green onion, "garbanzo" for
    chickpea. Looked up after a direct `Ingredient.norm_key` miss."""

    __tablename__ = "ingredient_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ingredient_id: Mapped[int] = mapped_column(ForeignKey("ingredients.id"))
    norm_key: Mapped[str] = mapped_column(String(120), unique=True, index=True)

    ingredient: Mapped["Ingredient"] = relationship(back_populates="aliases")


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    servings: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cook_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "manual" | "url" | "photo" | "text" -- how this recipe got here.
    source_type: Mapped[str] = mapped_column(String(20), default="manual")
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Hero image hotlinked from the source site. Scanned pages live in RecipeImage instead.
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    owner: Mapped["User"] = relationship()
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan", order_by="RecipeIngredient.sort_order"
    )
    steps: Mapped[list["RecipeStep"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan", order_by="RecipeStep.step_number"
    )
    images: Mapped[list["RecipeImage"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan", order_by="RecipeImage.sort_order"
    )
    tags: Mapped[list["RecipeTagName"]] = relationship(secondary=recipe_tags, back_populates="recipes")

    # Flat views of the relationships, so the Pydantic *Out schemas can read them via
    # from_attributes and templates don't need a loop to show a tag row.
    @property
    def tag_names(self) -> list[str]:
        return [tag.name for tag in self.tags]

    @property
    def image_ids(self) -> list[int]:
        return [image.id for image in self.images]

    @property
    def total_minutes(self) -> int | None:
        if self.prep_minutes is None and self.cook_minutes is None:
            return None
        return (self.prep_minutes or 0) + (self.cook_minutes or 0)


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"))
    # The original line, always shown to the cook. Parsing is for matching and scaling;
    # it is never allowed to lose what the recipe actually said.
    raw_text: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    prep_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    optional: Mapped[bool] = mapped_column(Boolean, default=False)
    # NULL means we couldn't resolve it to a canonical ingredient. The row still displays
    # and still goes to the grocery list; it just can't participate in "can I make this?".
    ingredient_id: Mapped[int | None] = mapped_column(ForeignKey("ingredients.id"), nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    recipe: Mapped["Recipe"] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient | None"] = relationship()


class RecipeStep(Base):
    __tablename__ = "recipe_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"))
    step_number: Mapped[int] = mapped_column(Integer, default=1)
    text: Mapped[str] = mapped_column(Text)

    recipe: Mapped["Recipe"] = relationship(back_populates="steps")


class RecipeTagName(Base):
    """Free-form label: "weeknight", "instant pot", "Mom's". Named RecipeTagName rather
    than RecipeTag so it doesn't collide with the `recipe_tags` association table."""

    __tablename__ = "recipe_tag_names"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    norm_key: Mapped[str] = mapped_column(String(60), unique=True, index=True)

    recipes: Mapped[list["Recipe"]] = relationship(secondary=recipe_tags, back_populates="tags")


class RecipeImage(Base):
    """A scanned or photographed page, stored in the database as bytes.

    Railway containers have an ephemeral filesystem and there's no object storage
    configured, so anything written to local disk is lost on the next deploy. Images are
    downscaled and JPEG-compressed before insert (see app/recipe_import.py), which keeps
    them small enough that this is a non-issue at family scale.
    """

    __tablename__ = "recipe_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    content_type: Mapped[str] = mapped_column(String(50), default="image/jpeg")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    recipe: Mapped["Recipe"] = relationship(back_populates="images")


class PantryItem(Base):
    """What's in the cupboard and the fridge. Household-global with no owner or
    visibility flag, matching how Freezer already works -- there's one kitchen."""

    __tablename__ = "pantry_items"
    __table_args__ = (UniqueConstraint("ingredient_id", "location", name="uq_pantry_ingredient_location"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ingredient_id: Mapped[int] = mapped_column(ForeignKey("ingredients.id"), index=True)
    # "pantry" | "fridge". The freezer is its own existing feature and isn't duplicated here.
    location: Mapped[str] = mapped_column(String(20), default="pantry")
    # Free text, matching the grocery and freezer convention ("half a bag", "2 cans").
    quantity: Mapped[str | None] = mapped_column(String(50), nullable=True)
    low: Mapped[bool] = mapped_column(Boolean, default=False)
    added_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    ingredient: Mapped["Ingredient"] = relationship()
    added_by: Mapped["User"] = relationship(foreign_keys=[added_by_id])
