from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import Token
from app.security import create_access_token, hash_password, verify_password
from app.templating import templates

router = APIRouter()


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login", response_class=HTMLResponse)
def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        return templates.TemplateResponse(
            request, "login.html", {"error": "Invalid username or password"}, status_code=400
        )

    last_page = request.session.get("last_page", "/grocery")
    request.session["user_id"] = user.id
    return RedirectResponse(url=last_page, status_code=status.HTTP_302_FOUND)


@router.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)


@router.get("/profile", response_class=HTMLResponse)
def profile_page(
    request: Request,
    success: bool = False,
    current_user: User = Depends(get_current_user),
):
    return templates.TemplateResponse(
        request, "profile.html", {"current_user": current_user, "success": success, "error": None}
    )


@router.post("/profile/change-password", response_class=HTMLResponse)
def change_password(
    request: Request,
    current_password: str = Form(...),
    new_password: str = Form(...),
    confirm_password: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    def error(msg: str):
        return templates.TemplateResponse(
            request, "profile.html", {"current_user": current_user, "success": False, "error": msg},
            status_code=400,
        )

    if not verify_password(current_password, current_user.password_hash):
        return error("Current password is incorrect.")
    if new_password != confirm_password:
        return error("New passwords do not match.")
    if len(new_password) < 8:
        return error("New password must be at least 8 characters.")

    current_user.password_hash = hash_password(new_password)
    db.commit()
    return RedirectResponse(url="/profile?success=true", status_code=status.HTTP_302_FOUND)


@router.post("/api/auth/token", response_model=Token)
def api_login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(subject=str(user.id))
    return Token(access_token=token)
