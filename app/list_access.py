from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Query, Session

from app.models import User


def visible_lists_query(db: Session, model, user: User) -> Query:
    return (
        db.query(model)
        .filter(or_(model.is_public.is_(True), model.owner_id == user.id))
        .order_by(model.name)
    )


def get_visible_list(db: Session, model, list_id: int, user: User):
    obj = db.get(model, list_id)
    if obj is None or not (obj.is_public or obj.owner_id == user.id):
        raise HTTPException(status_code=404, detail="List not found")
    return obj


def is_list_visible(obj, user: User) -> bool:
    return bool(obj.is_public or obj.owner_id == user.id)
