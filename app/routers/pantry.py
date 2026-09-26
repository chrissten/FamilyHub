from fastapi import APIRouter, Depends, Form, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.grocery_ops import add_or_merge_item
from app.ingredient_review import keep_separate, merge_ingredient
from app.ingredients import resolve
from app.list_access import get_visible_list, visible_lists_query
from app.models import GroceryList, Ingredient, PantryItem, User
from app.schemas import (
    IngredientMergeRequest,
    IngredientOut,
    PantryItemCreate,
    PantryItemOut,
    PantryItemUpdate,
)
from app.security import decode_access_token
from app.templating import templates
from app.ws_manager import pantry_manager

router = APIRouter()

# The pantry is household-global, like the freezer — there's one kitchen — so every
# connection shares a single room rather than one per list.
PANTRY_ROOM = 0

LOCATIONS = ("pantry", "fridge")


def render_pantry_item(item: PantryItem, oob_mode: str = "none") -> str:
    template = templates.get_template("_pantry_item_row.html")
    return template.render(item=item, oob_mode=oob_mode)


def staple_ingredients(db: Session) -> list[Ingredient]:
    """Everything currently assumed to be in the house."""
    return (
        db.query(Ingredient)
        .filter(Ingredient.is_staple.is_(True))
        .order_by(func.lower(Ingredient.name))
        .all()
    )


def render_staples(db: Session, oob: bool = False) -> str:
    template = templates.get_template("_pantry_staples.html")
    return template.render(staples=staple_ingredients(db), oob=oob)


def _normalize_location(value: str | None) -> str:
    location = (value or "pantry").strip().lower()
    return location if location in LOCATIONS else "pantry"


def _get_item_or_404(db: Session, item_id: int) -> PantryItem:
    item = (
        db.query(PantryItem)
        .options(joinedload(PantryItem.ingredient), joinedload(PantryItem.added_by))
        .filter(PantryItem.id == item_id)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Pantry item not found")
    return item


def add_pantry_item(
    db: Session, name: str, location: str, quantity: str | None, user: User
) -> tuple[PantryItem, bool]:
    """Put something in the pantry, or update what's already there.

    Creating the canonical ingredient when it's unknown is the point: adding "harissa" to
    the pantry is also how a recipe calling for harissa starts matching.
    """
    ingredient = resolve(db, name, create=True)
    if ingredient is None:
        raise HTTPException(status_code=422, detail="That doesn't look like an ingredient name")

    existing = (
        db.query(PantryItem)
        .filter(PantryItem.ingredient_id == ingredient.id, PantryItem.location == location)
        .first()
    )
    if existing is not None:
        if quantity:
            existing.quantity = quantity[:50]
        # Re-adding something means it's back, so it's no longer running low.
        existing.low = False
        db.commit()
        return _get_item_or_404(db, existing.id), False

    item = PantryItem(
        ingredient_id=ingredient.id,
        location=location,
        quantity=(quantity or None),
        added_by_id=user.id,
    )
    db.add(item)
    db.commit()
    return _get_item_or_404(db, item.id), True


# ── Web pages ───────────────────────────────────────────────────────────────────


@router.get("/pantry", response_class=HTMLResponse)
def pantry_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request.session["last_page"] = "/pantry"
    items = (
        db.query(PantryItem)
        .options(joinedload(PantryItem.ingredient), joinedload(PantryItem.added_by))
        .join(Ingredient)
        .order_by(func.lower(Ingredient.name))
        .all()
    )
    grouped = {location: [i for i in items if i.location == location] for location in LOCATIONS}
    # Everything known, for the quick-add datalist — typing a name that already exists
    # keeps the pantry on the same canonical row as the recipes that use it.
    known = [n for (n,) in db.query(Ingredient.name).order_by(func.lower(Ingredient.name))]
    lists = visible_lists_query(db, GroceryList, current_user).all()
    return templates.TemplateResponse(
        request,
        "pantry.html",
        {
            "grouped": grouped,
            "locations": LOCATIONS,
            "known_names": known,
            "lists": lists,
            "staples": staple_ingredients(db),
            "low_count": sum(1 for i in items if i.low),
            "current_user": current_user,
        },
    )


@router.post("/pantry/items", response_class=HTMLResponse)
async def pantry_add(
    name: str = Form(...),
    location: str = Form("pantry"),
    quantity: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    item, created = add_pantry_item(db, name, _normalize_location(location), quantity.strip() or None, current_user)
    html = render_pantry_item(item, oob_mode="insert" if created else "replace")
    await pantry_manager.broadcast(PANTRY_ROOM, html)
    return HTMLResponse(html)


@router.post("/pantry/items/{item_id}/low", response_class=HTMLResponse)
async def pantry_toggle_low(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = _get_item_or_404(db, item_id)
    item.low = not item.low
    db.commit()
    db.refresh(item)
    html = render_pantry_item(item, oob_mode="replace")
    await pantry_manager.broadcast(PANTRY_ROOM, html)
    return HTMLResponse(html)


@router.post("/pantry/items/{item_id}/delete", response_class=HTMLResponse)
async def pantry_delete(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = _get_item_or_404(db, item_id)
    db.delete(item)
    db.commit()
    html = f'<li id="pantry-item-{item_id}" hx-swap-oob="delete"></li>'
    await pantry_manager.broadcast(PANTRY_ROOM, html)
    return HTMLResponse(html)


@router.post("/pantry/staples", response_class=HTMLResponse)
async def pantry_add_staple(
    name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark an ingredient as always on hand.

    Creating an unknown name is deliberate, same as the pantry quick-add: "we always have
    fish sauce" should work whether or not a recipe has mentioned fish sauce yet.
    """
    if not name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    ingredient = resolve(db, name, create=True)
    if ingredient is None:
        raise HTTPException(status_code=422, detail="That doesn't look like an ingredient name")
    ingredient.is_staple = True
    db.commit()
    html = render_staples(db, oob=True)
    await pantry_manager.broadcast(PANTRY_ROOM, html)
    return HTMLResponse(html)


@router.post("/pantry/staples/{ingredient_id}/remove", response_class=HTMLResponse)
async def pantry_remove_staple(
    ingredient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear the flag only. The ingredient itself stays — recipes, pantry rows and
    grocery items point at it, so deleting it would take them with it."""
    ingredient = db.get(Ingredient, ingredient_id)
    if ingredient is None:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    ingredient.is_staple = False
    db.commit()
    html = render_staples(db, oob=True)
    await pantry_manager.broadcast(PANTRY_ROOM, html)
    return HTMLResponse(html)


@router.post("/pantry/restock")
async def pantry_restock(
    list_id: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send everything marked 'running low' to a grocery list.

    Uses the same add_or_merge_item as a recipe push, so an item a recipe already put on
    the list has its amount combined rather than being duplicated.
    """
    get_visible_list(db, GroceryList, list_id, current_user)
    low_items = (
        db.query(PantryItem)
        .options(joinedload(PantryItem.ingredient))
        .filter(PantryItem.low.is_(True))
        .all()
    )
    for item in low_items:
        add_or_merge_item(
            db,
            list_id,
            name=item.ingredient.name,
            quantity=None,
            category_name=item.ingredient.category,
            user_id=current_user.id,
        )
    return RedirectResponse(url=f"/grocery/lists/{list_id}", status_code=status.HTTP_302_FOUND)


# ── WebSocket ───────────────────────────────────────────────────────────────────


def _authenticate_ws_user(db: Session, session_user_id, token: str | None) -> User | None:
    user_id = session_user_id
    if user_id is None and token:
        user_id = decode_access_token(token)
    if user_id is None:
        return None
    return db.get(User, int(user_id))


@router.websocket("/ws/pantry")
async def pantry_ws(websocket: WebSocket, token: str | None = None):
    session = websocket.scope.get("session", {})
    db = SessionLocal()
    try:
        user = _authenticate_ws_user(db, session.get("user_id"), token)
    finally:
        db.close()
    if user is None:
        await websocket.close(code=4401)
        return
    await pantry_manager.connect(PANTRY_ROOM, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pantry_manager.disconnect(PANTRY_ROOM, websocket)


# ── JSON API ────────────────────────────────────────────────────────────────────


@router.get("/api/pantry/items", response_model=list[PantryItemOut])
def api_pantry_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(PantryItem)
        .options(joinedload(PantryItem.ingredient), joinedload(PantryItem.added_by))
        .join(Ingredient)
        .order_by(PantryItem.location, func.lower(Ingredient.name))
        .all()
    )


@router.get("/api/pantry/known", response_model=list[str])
def api_known_ingredients(
    q: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Autocomplete source for the mobile quick-add."""
    query = db.query(Ingredient.name)
    if q:
        query = query.filter(func.lower(Ingredient.name).like(f"%{q.strip().lower()}%"))
    return [n for (n,) in query.order_by(func.lower(Ingredient.name)).limit(50)]


@router.post("/api/pantry/items", response_model=PantryItemOut)
async def api_pantry_add(
    payload: PantryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item, created = add_pantry_item(
        db, payload.name, _normalize_location(payload.location), payload.quantity, current_user
    )
    await pantry_manager.broadcast(
        PANTRY_ROOM, render_pantry_item(item, oob_mode="insert" if created else "replace")
    )
    return item


@router.patch("/api/pantry/items/{item_id}", response_model=PantryItemOut)
async def api_pantry_update(
    item_id: int,
    payload: PantryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = _get_item_or_404(db, item_id)
    if payload.quantity is not None:
        item.quantity = payload.quantity[:50] or None
    if payload.low is not None:
        item.low = payload.low
    if payload.location is not None:
        item.location = _normalize_location(payload.location)
    db.commit()
    db.refresh(item)
    await pantry_manager.broadcast(PANTRY_ROOM, render_pantry_item(item, oob_mode="replace"))
    return item


@router.delete("/api/pantry/items/{item_id}", status_code=204)
async def api_pantry_delete(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = _get_item_or_404(db, item_id)
    db.delete(item)
    db.commit()
    await pantry_manager.broadcast(
        PANTRY_ROOM, f'<li id="pantry-item-{item_id}" hx-swap-oob="delete"></li>'
    )
    return HTMLResponse("", status_code=204)


# ── Ingredient review ("gran. sugar" is just sugar) ─────────────────────────────


def _get_ingredient_or_404(db: Session, ingredient_id: int) -> Ingredient:
    ingredient = db.get(Ingredient, ingredient_id)
    if ingredient is None:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    return ingredient


def _merge(db: Session, ingredient_id: int, into_id: int) -> Ingredient:
    if ingredient_id == into_id:
        raise HTTPException(status_code=422, detail="Can't merge an ingredient into itself")
    source = _get_ingredient_or_404(db, ingredient_id)
    target = _get_ingredient_or_404(db, into_id)
    merge_ingredient(db, source, target)
    return target


def _safe_next(next_url: str | None) -> str:
    # Only same-site paths, so the form can't be used to bounce someone off-site.
    if next_url and next_url.startswith("/") and not next_url.startswith("//"):
        return next_url
    return "/recipes"


@router.post("/ingredients/{ingredient_id}/merge")
def ingredient_merge(
    ingredient_id: int,
    into_id: int = Form(...),
    next: str = Form("/recipes"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _merge(db, ingredient_id, into_id)
    return RedirectResponse(url=_safe_next(next), status_code=status.HTTP_303_SEE_OTHER)


@router.post("/ingredients/{ingredient_id}/keep")
def ingredient_keep(
    ingredient_id: int,
    next: str = Form("/recipes"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    keep_separate(db, _get_ingredient_or_404(db, ingredient_id))
    return RedirectResponse(url=_safe_next(next), status_code=status.HTTP_303_SEE_OTHER)


@router.post("/api/ingredients/{ingredient_id}/merge", response_model=IngredientOut)
def api_ingredient_merge(
    ingredient_id: int,
    payload: IngredientMergeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the ingredient that survived."""
    return _merge(db, ingredient_id, payload.into_id)


@router.post("/api/ingredients/{ingredient_id}/keep", response_model=IngredientOut)
def api_ingredient_keep(
    ingredient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ingredient = _get_ingredient_or_404(db, ingredient_id)
    keep_separate(db, ingredient)
    return ingredient
