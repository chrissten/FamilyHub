from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import DeviceToken, User
from app.security import decode_access_token, hash_device_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    user_id = request.session.get("user_id")
    if user_id is None and token:
        user_id = decode_access_token(token)

    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user = db.get(User, int(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


def get_device(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> DeviceToken:
    """Auth for non-interactive machine clients (e.g. the Blotch frame widget) that
    carry a long-lived device token instead of logging in. Separate from
    get_current_user because a DeviceToken isn't a User and can't own data."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    raw_token = authorization[len("Bearer "):]
    token_hash = hash_device_token(raw_token)
    device = db.query(DeviceToken).filter(DeviceToken.token_hash == token_hash).first()
    if device is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    device.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return device
