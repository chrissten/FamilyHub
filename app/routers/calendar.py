import calendar as cal
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import CalendarEvent, User
from app.schemas import EventCreate, EventOut

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def build_month_grid(db: Session, year: int, month: int) -> list[list[dict]]:
    month_calendar = cal.Calendar(firstweekday=6)  # weeks start on Sunday
    weeks = month_calendar.monthdatescalendar(year, month)

    range_start = datetime.combine(weeks[0][0], time.min)
    range_end = datetime.combine(weeks[-1][-1], time.max)

    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time >= range_start, CalendarEvent.start_time <= range_end)
        .order_by(CalendarEvent.start_time)
        .all()
    )

    events_by_day: dict[date, list[CalendarEvent]] = {}
    for event in events:
        events_by_day.setdefault(event.start_time.date(), []).append(event)

    grid = []
    for week in weeks:
        grid.append(
            [
                {
                    "date": day,
                    "in_month": day.month == month,
                    "is_today": day == date.today(),
                    "events": events_by_day.get(day, []),
                }
                for day in week
            ]
        )
    return grid


@router.get("/calendar", response_class=HTMLResponse)
def calendar_page(
    request: Request,
    year: int | None = None,
    month: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    year, month = year or today.year, month or today.month
    grid = build_month_grid(db, year, month)
    return templates.TemplateResponse(
        request,
        "calendar.html",
        {"current_user": current_user, "grid": grid, "year": year, "month": month, "month_name": cal.month_name[month]},
    )


@router.get("/calendar/month", response_class=HTMLResponse)
def calendar_month_partial(
    request: Request,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grid = build_month_grid(db, year, month)
    return templates.TemplateResponse(
        request,
        "_calendar_month.html",
        {"grid": grid, "year": year, "month": month, "month_name": cal.month_name[month]},
    )


@router.get("/calendar/new", response_class=HTMLResponse)
def calendar_new_form(
    request: Request,
    date_str: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    members = db.query(User).order_by(User.display_name).all()
    return templates.TemplateResponse(
        request,
        "_event_form.html",
        {"event": None, "default_date": date_str, "members": members, "current_user": current_user},
    )


@router.get("/calendar/events/{event_id}/edit", response_class=HTMLResponse)
def calendar_edit_form(
    request: Request,
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    members = db.query(User).order_by(User.display_name).all()
    return templates.TemplateResponse(
        request,
        "_event_form.html",
        {"event": event, "default_date": None, "members": members, "current_user": current_user},
    )


def _month_response(request: Request, db: Session, year: int, month: int):
    grid = build_month_grid(db, year, month)
    return templates.TemplateResponse(
        request,
        "_calendar_month.html",
        {"grid": grid, "year": year, "month": month, "month_name": cal.month_name[month]},
    )


@router.post("/calendar/events", response_class=HTMLResponse)
def calendar_create_event(
    request: Request,
    title: str = Form(...),
    description: str = Form(""),
    location: str = Form(""),
    start_date: str = Form(...),
    start_time_str: str = Form("09:00"),
    end_time_str: str = Form("10:00"),
    all_day: bool = Form(False),
    attendee_ids: list[int] = Form([]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    day = date.fromisoformat(start_date)
    if all_day:
        start_dt = datetime.combine(day, time.min)
        end_dt = datetime.combine(day, time.max)
    else:
        start_dt = datetime.combine(day, time.fromisoformat(start_time_str))
        end_dt = datetime.combine(day, time.fromisoformat(end_time_str))

    event = CalendarEvent(
        owner_id=current_user.id,
        title=title,
        description=description or None,
        location=location or None,
        start_time=start_dt,
        end_time=end_dt,
        all_day=all_day,
    )
    event.attendees = db.query(User).filter(User.id.in_(attendee_ids or [current_user.id])).all()
    db.add(event)
    db.commit()
    return _month_response(request, db, day.year, day.month)


@router.post("/calendar/events/{event_id}", response_class=HTMLResponse)
def calendar_update_event(
    request: Request,
    event_id: int,
    title: str = Form(...),
    description: str = Form(""),
    location: str = Form(""),
    start_date: str = Form(...),
    start_time_str: str = Form("09:00"),
    end_time_str: str = Form("10:00"),
    all_day: bool = Form(False),
    attendee_ids: list[int] = Form([]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)

    day = date.fromisoformat(start_date)
    if all_day:
        start_dt = datetime.combine(day, time.min)
        end_dt = datetime.combine(day, time.max)
    else:
        start_dt = datetime.combine(day, time.fromisoformat(start_time_str))
        end_dt = datetime.combine(day, time.fromisoformat(end_time_str))

    event.title = title
    event.description = description or None
    event.location = location or None
    event.start_time = start_dt
    event.end_time = end_dt
    event.all_day = all_day
    event.attendees = db.query(User).filter(User.id.in_(attendee_ids)).all()
    db.commit()
    return _month_response(request, db, day.year, day.month)


@router.post("/calendar/events/{event_id}/delete", response_class=HTMLResponse)
def calendar_delete_event(
    request: Request,
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    year, month = event.start_time.year, event.start_time.month
    db.delete(event)
    db.commit()
    return _month_response(request, db, year, month)


@router.get("/api/events", response_model=list[EventOut])
def api_list_events(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(CalendarEvent).order_by(CalendarEvent.start_time).all()


@router.post("/api/events", response_model=EventOut)
def api_create_event(
    payload: EventCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    data = payload.model_dump(exclude={"attendee_ids"})
    event = CalendarEvent(owner_id=current_user.id, **data)
    event.attendees = db.query(User).filter(User.id.in_(payload.attendee_ids or [current_user.id])).all()
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.put("/api/events/{event_id}", response_model=EventOut)
def api_update_event(
    event_id: int,
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    for key, value in payload.model_dump(exclude={"attendee_ids"}).items():
        setattr(event, key, value)
    event.attendees = db.query(User).filter(User.id.in_(payload.attendee_ids)).all()
    db.commit()
    db.refresh(event)
    return event


@router.delete("/api/events/{event_id}")
def api_delete_event(
    event_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    db.delete(event)
    db.commit()
    return {"ok": True}
