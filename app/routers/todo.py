from fastapi import APIRouter, Depends, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.list_access import get_visible_list, is_list_visible, visible_lists_query
from app.models import TodoItem, TodoList, User
from app.schemas import TodoItemCreate, TodoItemOut, TodoListCreate, TodoListOut
from app.security import decode_access_token
from app.ws_manager import todo_manager

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def render_todo_item(item: TodoItem, oob_mode: str = "none") -> str:
    template = templates.get_template("_todo_item_row.html")
    return template.render(item=item, oob_mode=oob_mode)


@router.get("/todo", response_class=HTMLResponse)
def todo_lists_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lists = visible_lists_query(db, TodoList, current_user).all()
    return templates.TemplateResponse(
        request, "todo_lists.html", {"current_user": current_user, "lists": lists}
    )


@router.post("/todo/lists")
def todo_create_list(
    name: str = Form(...),
    is_public: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    todo_list = TodoList(name=name, owner_id=current_user.id, is_public=is_public)
    db.add(todo_list)
    db.commit()
    db.refresh(todo_list)
    return HTMLResponse(status_code=200, headers={"HX-Redirect": f"/todo/lists/{todo_list.id}"})


@router.get("/todo/lists/{list_id}", response_class=HTMLResponse)
def todo_list_page(
    request: Request,
    list_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    todo_list = get_visible_list(db, TodoList, list_id, current_user)
    items = (
        db.query(TodoItem)
        .filter(TodoItem.list_id == list_id)
        .order_by(TodoItem.sort_order, TodoItem.created_at)
        .all()
    )
    return templates.TemplateResponse(
        request, "todo_list.html", {"current_user": current_user, "todo_list": todo_list, "items": items}
    )


@router.post("/todo/lists/{list_id}/items", response_class=HTMLResponse)
async def todo_add_item(
    list_id: int,
    text: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_visible_list(db, TodoList, list_id, current_user)
    item = TodoItem(text=text, list_id=list_id, added_by_id=current_user.id)
    db.add(item)
    db.commit()
    db.refresh(item)

    html = render_todo_item(item, oob_mode="insert")
    await todo_manager.broadcast(list_id, html)
    return HTMLResponse(html)


def _get_todo_item_and_list(db: Session, item_id: int, current_user: User) -> tuple[TodoItem, int]:
    item = db.get(TodoItem, item_id)
    if not item:
        raise HTTPException(status_code=404)
    if not is_list_visible(item.todo_list, current_user):
        raise HTTPException(status_code=404)
    return item, item.list_id


@router.post("/todo/items/{item_id}/toggle", response_class=HTMLResponse)
async def todo_toggle_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    item, list_id = _get_todo_item_and_list(db, item_id, current_user)

    item.checked = not item.checked
    item.checked_by_id = current_user.id if item.checked else None
    db.commit()
    db.refresh(item)

    html = render_todo_item(item, oob_mode="replace")
    await todo_manager.broadcast(list_id, html)
    return HTMLResponse(html)


@router.post("/todo/items/{item_id}/delete", response_class=HTMLResponse)
async def todo_delete_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    item, list_id = _get_todo_item_and_list(db, item_id, current_user)

    db.delete(item)
    db.commit()

    html = f'<li id="todo-item-{item_id}" hx-swap-oob="delete"></li>'
    await todo_manager.broadcast(list_id, html)
    return HTMLResponse(html)


def _authenticate_ws_user(db: Session, session_user_id, token: str | None) -> User | None:
    user_id = session_user_id
    if user_id is None and token:
        user_id = decode_access_token(token)
    if user_id is None:
        return None
    return db.get(User, int(user_id))


@router.websocket("/ws/todo/{list_id}")
async def todo_ws(websocket: WebSocket, list_id: int, token: str | None = None):
    session = websocket.scope.get("session", {})
    db = SessionLocal()
    try:
        user = _authenticate_ws_user(db, session.get("user_id"), token)
        todo_list = db.get(TodoList, list_id) if user else None
        if user is None or todo_list is None or not is_list_visible(todo_list, user):
            await websocket.close(code=4401)
            return
    finally:
        db.close()

    await todo_manager.connect(list_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        todo_manager.disconnect(list_id, websocket)


@router.get("/api/todo/lists", response_model=list[TodoListOut])
def api_list_todo_lists(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return visible_lists_query(db, TodoList, current_user).all()


@router.post("/api/todo/lists", response_model=TodoListOut)
def api_create_todo_list(
    payload: TodoListCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    todo_list = TodoList(name=payload.name, owner_id=current_user.id, is_public=payload.is_public)
    db.add(todo_list)
    db.commit()
    db.refresh(todo_list)
    return todo_list


@router.get("/api/todo/lists/{list_id}/items", response_model=list[TodoItemOut])
def api_list_todo_items(
    list_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    get_visible_list(db, TodoList, list_id, current_user)
    return db.query(TodoItem).filter(TodoItem.list_id == list_id).order_by(TodoItem.sort_order).all()


@router.post("/api/todo/lists/{list_id}/items", response_model=TodoItemOut)
async def api_create_todo_item(
    list_id: int,
    payload: TodoItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_visible_list(db, TodoList, list_id, current_user)
    item = TodoItem(text=payload.text, list_id=list_id, added_by_id=current_user.id)
    db.add(item)
    db.commit()
    db.refresh(item)

    html = render_todo_item(item, oob_mode="insert")
    await todo_manager.broadcast(list_id, html)
    return item


@router.post("/api/todo/items/{item_id}/toggle", response_model=TodoItemOut)
async def api_toggle_todo_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    item, list_id = _get_todo_item_and_list(db, item_id, current_user)

    item.checked = not item.checked
    item.checked_by_id = current_user.id if item.checked else None
    db.commit()
    db.refresh(item)

    html = render_todo_item(item, oob_mode="replace")
    await todo_manager.broadcast(list_id, html)
    return item


@router.delete("/api/todo/items/{item_id}")
async def api_delete_todo_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    item, list_id = _get_todo_item_and_list(db, item_id, current_user)

    db.delete(item)
    db.commit()

    html = f'<li id="todo-item-{item_id}" hx-swap-oob="delete"></li>'
    await todo_manager.broadcast(list_id, html)
    return {"ok": True}
