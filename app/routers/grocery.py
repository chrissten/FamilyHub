from fastapi import APIRouter, Depends, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.list_access import get_visible_list, is_list_visible, visible_lists_query
from app.models import GroceryCategory, GroceryItem, GroceryList, User
from app.schemas import (
    CategoryCreate,
    CategoryOut,
    GroceryListCreate,
    GroceryListOut,
    ItemCreate,
    ItemOut,
)
from app.security import decode_access_token
from app.ws_manager import grocery_manager

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def render_item(item: GroceryItem, oob_mode: str = "none") -> str:
    template = templates.get_template("_grocery_item_row.html")
    return template.render(item=item, oob_mode=oob_mode)


def render_category(category: GroceryCategory, oob_mode: str = "none") -> str:
    template = templates.get_template("_grocery_category.html")
    return template.render(category=category, oob_mode=oob_mode)


@router.get("/grocery", response_class=HTMLResponse)
def grocery_lists_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lists = visible_lists_query(db, GroceryList, current_user).all()
    return templates.TemplateResponse(
        request, "grocery_lists.html", {"current_user": current_user, "lists": lists}
    )


@router.post("/grocery/lists")
def grocery_create_list(
    name: str = Form(...),
    is_public: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grocery_list = GroceryList(name=name, owner_id=current_user.id, is_public=is_public)
    db.add(grocery_list)
    db.commit()
    db.refresh(grocery_list)
    return HTMLResponse(status_code=200, headers={"HX-Redirect": f"/grocery/lists/{grocery_list.id}"})


@router.get("/grocery/lists/{list_id}", response_class=HTMLResponse)
def grocery_list_page(
    request: Request,
    list_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grocery_list = get_visible_list(db, GroceryList, list_id, current_user)
    categories = (
        db.query(GroceryCategory)
        .filter(GroceryCategory.list_id == list_id)
        .order_by(GroceryCategory.sort_order, GroceryCategory.name)
        .all()
    )
    return templates.TemplateResponse(
        request,
        "grocery_list.html",
        {"current_user": current_user, "grocery_list": grocery_list, "categories": categories},
    )


@router.post("/grocery/lists/{list_id}/categories", response_class=HTMLResponse)
async def grocery_add_category(
    list_id: int,
    name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_visible_list(db, GroceryList, list_id, current_user)
    category = GroceryCategory(name=name, list_id=list_id)
    db.add(category)
    db.commit()
    db.refresh(category)

    html = render_category(category, oob_mode="insert")
    await grocery_manager.broadcast(list_id, html)
    return HTMLResponse(html)


@router.post("/grocery/lists/{list_id}/items", response_class=HTMLResponse)
async def grocery_add_item(
    list_id: int,
    name: str = Form(...),
    quantity: str = Form(""),
    category_id: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_visible_list(db, GroceryList, list_id, current_user)
    category = db.get(GroceryCategory, category_id)
    if not category or category.list_id != list_id:
        raise HTTPException(status_code=404, detail="Category not found in this list")

    item = GroceryItem(
        name=name, quantity=quantity or None, category_id=category_id, added_by_id=current_user.id
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    html = render_item(item, oob_mode="insert")
    await grocery_manager.broadcast(list_id, html)
    return HTMLResponse(html)


def _get_item_and_list(db: Session, item_id: int, current_user: User) -> tuple[GroceryItem, int]:
    item = db.get(GroceryItem, item_id)
    if not item:
        raise HTTPException(status_code=404)
    list_id = item.category.list_id
    if not is_list_visible(item.category.grocery_list, current_user):
        raise HTTPException(status_code=404)
    return item, list_id


@router.post("/grocery/items/{item_id}/toggle", response_class=HTMLResponse)
async def grocery_toggle_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item, list_id = _get_item_and_list(db, item_id, current_user)

    item.checked = not item.checked
    item.checked_by_id = current_user.id if item.checked else None
    db.commit()
    db.refresh(item)

    html = render_item(item, oob_mode="replace")
    await grocery_manager.broadcast(list_id, html)
    return HTMLResponse(html)


@router.post("/grocery/items/{item_id}/delete", response_class=HTMLResponse)
async def grocery_delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item, list_id = _get_item_and_list(db, item_id, current_user)

    db.delete(item)
    db.commit()

    html = f'<li id="item-{item_id}" hx-swap-oob="delete"></li>'
    await grocery_manager.broadcast(list_id, html)
    return HTMLResponse(html)


def _authenticate_ws_user(db: Session, session_user_id, token: str | None) -> User | None:
    user_id = session_user_id
    if user_id is None and token:
        user_id = decode_access_token(token)
    if user_id is None:
        return None
    return db.get(User, int(user_id))


@router.websocket("/ws/grocery/{list_id}")
async def grocery_ws(websocket: WebSocket, list_id: int, token: str | None = None):
    session = websocket.scope.get("session", {})
    db = SessionLocal()
    try:
        user = _authenticate_ws_user(db, session.get("user_id"), token)
        grocery_list = db.get(GroceryList, list_id) if user else None
        if user is None or grocery_list is None or not is_list_visible(grocery_list, user):
            await websocket.close(code=4401)
            return
    finally:
        db.close()

    await grocery_manager.connect(list_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        grocery_manager.disconnect(list_id, websocket)


@router.get("/api/grocery/lists", response_model=list[GroceryListOut])
def api_list_grocery_lists(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return visible_lists_query(db, GroceryList, current_user).all()


@router.post("/api/grocery/lists", response_model=GroceryListOut)
def api_create_grocery_list(
    payload: GroceryListCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    grocery_list = GroceryList(name=payload.name, owner_id=current_user.id, is_public=payload.is_public)
    db.add(grocery_list)
    db.commit()
    db.refresh(grocery_list)
    return grocery_list


@router.get("/api/grocery/lists/{list_id}/categories", response_model=list[CategoryOut])
def api_list_categories(
    list_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    get_visible_list(db, GroceryList, list_id, current_user)
    return db.query(GroceryCategory).filter(GroceryCategory.list_id == list_id).order_by(GroceryCategory.sort_order).all()


@router.post("/api/grocery/lists/{list_id}/categories", response_model=CategoryOut)
def api_create_category(
    list_id: int,
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_visible_list(db, GroceryList, list_id, current_user)
    category = GroceryCategory(name=payload.name, list_id=list_id)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.get("/api/grocery/lists/{list_id}/items", response_model=list[ItemOut])
def api_list_items(list_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    get_visible_list(db, GroceryList, list_id, current_user)
    return (
        db.query(GroceryItem)
        .join(GroceryCategory)
        .filter(GroceryCategory.list_id == list_id)
        .order_by(GroceryItem.created_at)
        .all()
    )


@router.post("/api/grocery/lists/{list_id}/items", response_model=ItemOut)
async def api_create_item(
    list_id: int,
    payload: ItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_visible_list(db, GroceryList, list_id, current_user)
    category = db.get(GroceryCategory, payload.category_id)
    if not category or category.list_id != list_id:
        raise HTTPException(status_code=404, detail="Category not found in this list")

    item = GroceryItem(
        name=payload.name,
        quantity=payload.quantity,
        category_id=payload.category_id,
        added_by_id=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    html = render_item(item, oob_mode="insert")
    await grocery_manager.broadcast(list_id, html)
    return item


@router.post("/api/grocery/items/{item_id}/toggle", response_model=ItemOut)
async def api_toggle_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    item, list_id = _get_item_and_list(db, item_id, current_user)

    item.checked = not item.checked
    item.checked_by_id = current_user.id if item.checked else None
    db.commit()
    db.refresh(item)

    html = render_item(item, oob_mode="replace")
    await grocery_manager.broadcast(list_id, html)
    return item


@router.delete("/api/grocery/items/{item_id}")
async def api_delete_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    item, list_id = _get_item_and_list(db, item_id, current_user)

    db.delete(item)
    db.commit()

    html = f'<li id="item-{item_id}" hx-swap-oob="delete"></li>'
    await grocery_manager.broadcast(list_id, html)
    return {"ok": True}
