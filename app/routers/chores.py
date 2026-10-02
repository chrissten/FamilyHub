from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Chore, ChoreCompletion, User
from app.routers.calendar import _viewer_tz
from app.schemas import ChoreCompletionOut, ChoreCreate, ChoreOut, ChoreToggle, ChoreToggleOut
from app.templating import templates

router = APIRouter()

ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def weekday_sunday0(d: date) -> int:
    return (d.weekday() + 1) % 7


def week_start(d: date) -> date:
    return d - timedelta(days=weekday_sunday0(d))


def chore_days(chore: Chore) -> list[int]:
    return [int(c) for c in chore.days]


def is_due(chore: Chore, d: date) -> bool:
    return str(weekday_sunday0(d)) in chore.days


def encode_days(days: list[int]) -> str:
    cleaned = sorted({d for d in days if 0 <= d <= 6})
    if not cleaned:
        raise HTTPException(status_code=422, detail="Pick at least one day")
    return "".join(str(d) for d in cleaned)


def clean_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="A chore needs a name")
    return name[:200]


def check_assignee(db: Session, assignee_id: int | None) -> int | None:
    if assignee_id is not None and db.get(User, assignee_id) is None:
        raise HTTPException(status_code=422, detail="Unknown person")
    return assignee_id


def get_chore(db: Session, chore_id: int) -> Chore:
    chore = db.get(Chore, chore_id)
    if chore is None:
        raise HTTPException(status_code=404, detail="Chore not found")
    return chore


def toggle_completion(db: Session, chore: Chore, day: date, user: User) -> ChoreCompletion | None:
    """Ticks the chore for `day`, or unticks it if it was already done. Returns the new
    completion, or None when it was removed."""
    existing = (
        db.query(ChoreCompletion)
        .filter(ChoreCompletion.chore_id == chore.id, ChoreCompletion.done_on == day)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        return None
    completion = ChoreCompletion(chore_id=chore.id, done_on=day, completed_by_id=user.id)
    db.add(completion)
    db.commit()
    db.refresh(completion)
    return completion


def viewer_today(request: Request) -> date:
    return datetime.now(ZoneInfo(_viewer_tz(request))).date()


def ordered_chores(db: Session) -> list[Chore]:
    return db.query(Chore).order_by(Chore.name).all()


def render_cell(chore: Chore, day: date, completion: ChoreCompletion | None, today: date) -> str:
    return templates.get_template("_chore_cell.html").render(
        chore=chore, day=day, completion=completion, today=today, due=is_due(chore, day)
    )


# -- Web ----------------------------------------------------------------------


@router.get("/chores", response_class=HTMLResponse)
def chores_page(
    request: Request,
    start: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request.session["last_page"] = "/chores"
    today = viewer_today(request)
    first = week_start(start or today)
    days = [first + timedelta(days=i) for i in range(7)]

    chores = ordered_chores(db)
    done = {
        (c.chore_id, c.done_on): c
        for c in db.query(ChoreCompletion).filter(ChoreCompletion.done_on.between(days[0], days[-1])).all()
    }

    members = db.query(User).order_by(User.display_name).all()
    groups = [(m, [c for c in chores if c.assignee_id == m.id]) for m in members]
    groups = [(m, cs) for m, cs in groups if cs]
    anyone = [c for c in chores if c.assignee_id is None]
    if anyone:
        groups.append((None, anyone))

    return templates.TemplateResponse(
        request,
        "chores.html",
        {
            "current_user": current_user,
            "groups": groups,
            "chores": chores,
            "days": days,
            "done": done,
            "today": today,
            "is_current_week": first == week_start(today),
            "start": first,
            "prev_start": first - timedelta(days=7),
            "next_start": first + timedelta(days=7),
            "members": members,
            "day_names": DAY_NAMES,
            "all_days": ALL_DAYS,
            "render_cell": render_cell,
        },
    )


@router.post("/chores")
def chores_create(
    name: str = Form(...),
    assignee_id: str = Form(""),
    days: list[int] = Form([]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chore = Chore(
        name=clean_name(name),
        assignee_id=check_assignee(db, int(assignee_id) if assignee_id else None),
        days=encode_days(days or ALL_DAYS),
        created_by_id=current_user.id,
    )
    db.add(chore)
    db.commit()
    return RedirectResponse(url="/chores", status_code=status.HTTP_302_FOUND)


@router.post("/chores/{chore_id}/update")
def chores_update(
    chore_id: int,
    name: str = Form(...),
    assignee_id: str = Form(""),
    days: list[int] = Form([]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chore = get_chore(db, chore_id)
    chore.name = clean_name(name)
    chore.assignee_id = check_assignee(db, int(assignee_id) if assignee_id else None)
    chore.days = encode_days(days)
    db.commit()
    return RedirectResponse(url="/chores", status_code=status.HTTP_302_FOUND)


@router.post("/chores/{chore_id}/delete")
def chores_delete(
    chore_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    db.delete(get_chore(db, chore_id))
    db.commit()
    return RedirectResponse(url="/chores", status_code=status.HTTP_302_FOUND)


@router.post("/chores/{chore_id}/toggle", response_class=HTMLResponse)
def chores_toggle(
    request: Request,
    chore_id: int,
    day: date = Form(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chore = get_chore(db, chore_id)
    completion = toggle_completion(db, chore, day, current_user)
    return HTMLResponse(render_cell(chore, day, completion, viewer_today(request)))


# -- JSON API (mobile + tablet) -------------------------------------------------


def chore_out(chore: Chore) -> ChoreOut:
    return ChoreOut(id=chore.id, name=chore.name, assignee_id=chore.assignee_id, days=chore_days(chore))


@router.get("/api/chores", response_model=list[ChoreOut])
def api_list_chores(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [chore_out(c) for c in ordered_chores(db)]


@router.post("/api/chores", response_model=ChoreOut)
def api_create_chore(
    payload: ChoreCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    chore = Chore(
        name=clean_name(payload.name),
        assignee_id=check_assignee(db, payload.assignee_id),
        days=encode_days(payload.days),
        created_by_id=current_user.id,
    )
    db.add(chore)
    db.commit()
    db.refresh(chore)
    return chore_out(chore)


@router.put("/api/chores/{chore_id}", response_model=ChoreOut)
def api_update_chore(
    chore_id: int,
    payload: ChoreCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chore = get_chore(db, chore_id)
    chore.name = clean_name(payload.name)
    chore.assignee_id = check_assignee(db, payload.assignee_id)
    chore.days = encode_days(payload.days)
    db.commit()
    db.refresh(chore)
    return chore_out(chore)


@router.delete("/api/chores/{chore_id}")
def api_delete_chore(
    chore_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    db.delete(get_chore(db, chore_id))
    db.commit()
    return {"ok": True}


@router.get("/api/chores/completions", response_model=list[ChoreCompletionOut])
def api_list_completions(
    start: date,
    end: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(ChoreCompletion)
        .filter(ChoreCompletion.done_on.between(start, end))
        .order_by(ChoreCompletion.done_on)
        .all()
    )
    return [ChoreCompletionOut(chore_id=r.chore_id, date=r.done_on, completed_by=r.completed_by) for r in rows]


@router.post("/api/chores/{chore_id}/toggle", response_model=ChoreToggleOut)
def api_toggle_chore(
    chore_id: int,
    payload: ChoreToggle,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chore = get_chore(db, chore_id)
    completion = toggle_completion(db, chore, payload.date, current_user)
    return ChoreToggleOut(
        chore_id=chore.id,
        date=payload.date,
        done=completion is not None,
        completed_by=completion.completed_by if completion else None,
    )
