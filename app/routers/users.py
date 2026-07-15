from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import User
from app.schemas import UserColorUpdate, UserCreate, UserOut
from app.security import hash_password
from app.templating import templates

router = APIRouter()


@router.get("/users", response_class=HTMLResponse)
def users_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    members = db.query(User).order_by(User.id).all()
    return templates.TemplateResponse(
        request,
        "users.html",
        {"members": members, "current_user": current_user, "error": None},
    )


@router.post("/users", response_class=HTMLResponse)
def users_add(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    display_name: str = Form(...),
    color_hex: str = Form(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if db.query(User).filter(User.username == username).first():
        members = db.query(User).order_by(User.id).all()
        return templates.TemplateResponse(
            request,
            "users.html",
            {"members": members, "current_user": admin, "error": "Username already taken"},
            status_code=400,
        )

    member = User(
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
        color_hex=color_hex,
    )
    db.add(member)
    db.commit()
    return RedirectResponse(url="/users", status_code=status.HTTP_302_FOUND)


@router.post("/users/{user_id}/color", response_class=HTMLResponse)
def users_update_color(
    user_id: int,
    color_hex: str = Form(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    member = db.query(User).filter(User.id == user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.color_hex = color_hex
    db.commit()
    return RedirectResponse(url="/users", status_code=status.HTTP_302_FOUND)


@router.get("/api/users", response_model=list[UserOut])
def api_list_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(User).order_by(User.id).all()


@router.post("/api/users", response_model=UserOut)
def api_create_user(payload: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    member = User(
        username=payload.username,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        color_hex=payload.color_hex,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch("/api/users/{user_id}", response_model=UserOut)
def api_update_user_color(
    user_id: int,
    payload: UserColorUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    member = db.query(User).filter(User.id == user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.color_hex = payload.color_hex
    db.commit()
    db.refresh(member)
    return member
