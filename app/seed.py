from sqlalchemy.orm import Session

from app.config import settings
from app.models import User
from app.security import hash_password


def seed_admin(db: Session) -> None:
    if db.query(User).count() > 0:
        return

    admin = User(
        username=settings.admin_username,
        display_name=settings.admin_display_name,
        password_hash=hash_password(settings.admin_password),
        color_hex=settings.admin_color,
        is_admin=True,
    )
    db.add(admin)
    db.commit()
