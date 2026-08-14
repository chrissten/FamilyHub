from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import DeviceToken, User
from app.security import generate_device_token, hash_device_token
from app.templating import templates

router = APIRouter()


@router.get("/devices", response_class=HTMLResponse)
def devices_page(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    tokens = db.query(DeviceToken).order_by(DeviceToken.created_at).all()
    return templates.TemplateResponse(
        request,
        "devices.html",
        {"tokens": tokens, "current_user": admin, "new_token": None, "error": None},
    )


@router.post("/devices", response_class=HTMLResponse)
def devices_create(
    request: Request,
    label: str = Form(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    raw_token = generate_device_token()
    device = DeviceToken(
        label=label,
        token_hash=hash_device_token(raw_token),
        token_prefix=raw_token[:8],
        created_by_id=admin.id,
    )
    db.add(device)
    db.commit()

    tokens = db.query(DeviceToken).order_by(DeviceToken.created_at).all()
    return templates.TemplateResponse(
        request,
        "devices.html",
        {"tokens": tokens, "current_user": admin, "new_token": raw_token, "error": None},
    )


@router.post("/devices/{device_id}/revoke", response_class=HTMLResponse)
def devices_revoke(
    device_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    device = db.get(DeviceToken, device_id)
    if not device:
        raise HTTPException(status_code=404)
    db.delete(device)
    db.commit()
    return RedirectResponse(url="/devices", status_code=status.HTTP_302_FOUND)
