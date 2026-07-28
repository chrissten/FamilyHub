from datetime import date

from fastapi import APIRouter, Depends, Form, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.models import Freezer, FreezerItem, User
from app.schemas import FreezerCreate, FreezerItemCreate, FreezerItemOut, FreezerItemUpdate, FreezerOut, ReorderPayload
from app.security import decode_access_token
from app.templating import templates
from app.ws_manager import freezer_manager

router = APIRouter()


def render_freezer_item(item: FreezerItem, oob_mode: str = "none") -> str:
    template = templates.get_template("_freezer_item_row.html")
    return template.render(item=item, oob_mode=oob_mode)


def _get_freezer_or_404(db: Session, freezer_id: int) -> Freezer:
    freezer = db.get(Freezer, freezer_id)
    if freezer is None:
        raise HTTPException(status_code=404, detail="Freezer not found")
    return freezer


def _get_freezer_item_and_freezer_id(db: Session, item_id: int) -> tuple[FreezerItem, int]:
    item = db.get(FreezerItem, item_id)
    if not item:
        raise HTTPException(status_code=404)
    return item, item.freezer_id


def _parse_form_date(value: str) -> date | None:
    return date.fromisoformat(value) if value else None


@router.get("/freezer", response_class=HTMLResponse)
def freezer_lists_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request.session["last_page"] = "/freezer"
    freezers = db.query(Freezer).order_by(Freezer.created_at).all()
    return templates.TemplateResponse(
        request, "freezer_lists.html", {"current_user": current_user, "freezers": freezers}
    )


@router.post("/freezer/freezers")
def freezer_create(
    name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    freezer = Freezer(name=name)
    db.add(freezer)
    db.commit()
    db.refresh(freezer)
    return RedirectResponse(url="/freezer", status_code=status.HTTP_302_FOUND)


@router.post("/freezer/freezers/{freezer_id}/delete", response_class=HTMLResponse)
def freezer_delete(
    freezer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    freezer = _get_freezer_or_404(db, freezer_id)
    db.delete(freezer)
    db.commit()
    return HTMLResponse("")


@router.post("/freezer/freezers/{freezer_id}/items", response_class=HTMLResponse)
async def freezer_add_item(
    freezer_id: int,
    name: str = Form(...),
    quantity: str = Form(""),
    quantity_unit: str = Form(""),
    date_purchased: str = Form(""),
    expiration_date: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_freezer_or_404(db, freezer_id)
    item = FreezerItem(
        name=name,
        quantity=quantity or None,
        quantity_unit=quantity_unit or None,
        date_purchased=_parse_form_date(date_purchased),
        expiration_date=_parse_form_date(expiration_date),
        freezer_id=freezer_id,
        added_by_id=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    html = render_freezer_item(item, oob_mode="insert")
    await freezer_manager.broadcast(freezer_id, html)
    return HTMLResponse(html)


@router.post("/freezer/freezers/{freezer_id}/items/reorder", response_class=HTMLResponse)
async def freezer_reorder_items(
    freezer_id: int,
    payload: ReorderPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_freezer_or_404(db, freezer_id)
    for i, item_id in enumerate(payload.item_ids):
        item = db.get(FreezerItem, item_id)
        if item and item.freezer_id == freezer_id:
            item.sort_order = i * 10
    db.commit()
    return HTMLResponse("")


@router.post("/freezer/items/{item_id}/update", response_class=HTMLResponse)
async def freezer_update_item(
    item_id: int,
    name: str = Form(...),
    quantity: str = Form(""),
    quantity_unit: str = Form(""),
    date_purchased: str = Form(""),
    expiration_date: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item, freezer_id = _get_freezer_item_and_freezer_id(db, item_id)

    item.name = name
    item.quantity = quantity or None
    item.quantity_unit = quantity_unit or None
    item.date_purchased = _parse_form_date(date_purchased)
    item.expiration_date = _parse_form_date(expiration_date)
    db.commit()
    db.refresh(item)

    html = render_freezer_item(item, oob_mode="replace")
    await freezer_manager.broadcast(freezer_id, html)
    return HTMLResponse(html)


@router.post("/freezer/items/{item_id}/delete", response_class=HTMLResponse)
async def freezer_delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item, freezer_id = _get_freezer_item_and_freezer_id(db, item_id)

    db.delete(item)
    db.commit()

    html = f'<li id="freezer-item-{item_id}" hx-swap-oob="delete"></li>'
    await freezer_manager.broadcast(freezer_id, html)
    return HTMLResponse(html)


def _authenticate_ws_user(db: Session, session_user_id, token: str | None) -> User | None:
    user_id = session_user_id
    if user_id is None and token:
        user_id = decode_access_token(token)
    if user_id is None:
        return None
    return db.get(User, int(user_id))


@router.websocket("/ws/freezer/{freezer_id}")
async def freezer_ws(websocket: WebSocket, freezer_id: int, token: str | None = None):
    session = websocket.scope.get("session", {})
    db = SessionLocal()
    try:
        user = _authenticate_ws_user(db, session.get("user_id"), token)
        freezer = db.get(Freezer, freezer_id) if user else None
        if user is None or freezer is None:
            await websocket.close(code=4401)
            return
    finally:
        db.close()

    await freezer_manager.connect(freezer_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        freezer_manager.disconnect(freezer_id, websocket)


@router.get("/api/freezer/freezers", response_model=list[FreezerOut])
def api_list_freezers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Freezer).order_by(Freezer.created_at).all()


@router.post("/api/freezer/freezers", response_model=FreezerOut)
def api_create_freezer(
    payload: FreezerCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    freezer = Freezer(name=payload.name)
    db.add(freezer)
    db.commit()
    db.refresh(freezer)
    return freezer


@router.get("/api/freezer/freezers/{freezer_id}/items", response_model=list[FreezerItemOut])
def api_list_freezer_items(
    freezer_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    _get_freezer_or_404(db, freezer_id)
    return (
        db.query(FreezerItem)
        .filter(FreezerItem.freezer_id == freezer_id)
        .order_by(FreezerItem.sort_order, FreezerItem.created_at)
        .all()
    )


@router.post("/api/freezer/freezers/{freezer_id}/items", response_model=FreezerItemOut)
async def api_create_freezer_item(
    freezer_id: int,
    payload: FreezerItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_freezer_or_404(db, freezer_id)
    item = FreezerItem(
        name=payload.name,
        quantity=payload.quantity,
        quantity_unit=payload.quantity_unit,
        date_purchased=payload.date_purchased,
        expiration_date=payload.expiration_date,
        freezer_id=freezer_id,
        added_by_id=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    html = render_freezer_item(item, oob_mode="insert")
    await freezer_manager.broadcast(freezer_id, html)
    return item


@router.patch("/api/freezer/items/{item_id}", response_model=FreezerItemOut)
async def api_update_freezer_item(
    item_id: int,
    payload: FreezerItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item, freezer_id = _get_freezer_item_and_freezer_id(db, item_id)

    item.name = payload.name
    item.quantity = payload.quantity
    item.quantity_unit = payload.quantity_unit
    item.date_purchased = payload.date_purchased
    item.expiration_date = payload.expiration_date
    db.commit()
    db.refresh(item)

    html = render_freezer_item(item, oob_mode="replace")
    await freezer_manager.broadcast(freezer_id, html)
    return item


@router.delete("/api/freezer/items/{item_id}")
async def api_delete_freezer_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    item, freezer_id = _get_freezer_item_and_freezer_id(db, item_id)

    db.delete(item)
    db.commit()

    html = f'<li id="freezer-item-{item_id}" hx-swap-oob="delete"></li>'
    await freezer_manager.broadcast(freezer_id, html)
    return {"ok": True}
