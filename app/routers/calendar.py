import calendar as cal
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import CalendarEvent, User
from app.schemas import EventCreate, EventOut
from app.templating import templates

router = APIRouter()

PIXELS_PER_HOUR = 48


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


def _hour_label(hour: int) -> str:
    period = "AM" if hour < 12 else "PM"
    hour12 = hour % 12 or 12
    return f"{hour12} {period}"


def layout_day_blocks(events: list[CalendarEvent], day: date) -> list[dict]:
    """Greedy column layout for overlapping timed events within a single day."""
    day_start = datetime.combine(day, time.min)
    sorted_events = sorted(events, key=lambda e: e.start_time)

    columns_end: list[datetime] = []
    placements: list[tuple[CalendarEvent, int]] = []
    for event in sorted_events:
        placed_col = None
        for idx, col_end in enumerate(columns_end):
            if event.start_time >= col_end:
                columns_end[idx] = event.end_time
                placed_col = idx
                break
        if placed_col is None:
            columns_end.append(event.end_time)
            placed_col = len(columns_end) - 1
        placements.append((event, placed_col))

    total_cols = len(columns_end) or 1
    blocks = []
    for event, col in placements:
        start_minutes = max(0.0, (event.start_time - day_start).total_seconds() / 60)
        end_minutes = min(24 * 60.0, (event.end_time - day_start).total_seconds() / 60)
        duration = max(end_minutes - start_minutes, 20.0)
        blocks.append(
            {
                "event": event,
                "top": round(start_minutes / 60 * PIXELS_PER_HOUR, 1),
                "height": round(duration / 60 * PIXELS_PER_HOUR, 1),
                "left_pct": round(col / total_cols * 100, 2),
                "width_pct": round(100 / total_cols, 2),
            }
        )
    return blocks


def build_week_view(db: Session, anchor: date) -> dict:
    weekday_from_sunday = (anchor.weekday() + 1) % 7
    week_start = anchor - timedelta(days=weekday_from_sunday)
    week_dates = [week_start + timedelta(days=i) for i in range(7)]

    range_start = datetime.combine(week_dates[0], time.min)
    range_end = datetime.combine(week_dates[-1], time.max)
    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )

    days = []
    for day in week_dates:
        day_start = datetime.combine(day, time.min)
        day_end = datetime.combine(day, time.max)
        day_events = [e for e in events if e.start_time <= day_end and e.end_time >= day_start]
        days.append(
            {
                "date": day,
                "is_today": day == date.today(),
                "all_day_events": [e for e in day_events if e.all_day],
                "blocks": layout_day_blocks([e for e in day_events if not e.all_day], day),
            }
        )

    week_end = week_dates[-1]
    if week_start.month == week_end.month:
        label = f"{cal.month_name[week_start.month]} {week_start.day}–{week_end.day}, {week_start.year}"
    elif week_start.year == week_end.year:
        label = (
            f"{cal.month_name[week_start.month]} {week_start.day} – "
            f"{cal.month_name[week_end.month]} {week_end.day}, {week_start.year}"
        )
    else:
        label = (
            f"{cal.month_name[week_start.month]} {week_start.day}, {week_start.year} – "
            f"{cal.month_name[week_end.month]} {week_end.day}, {week_end.year}"
        )

    return {
        "week_days": days,
        "hours": [(h, _hour_label(h)) for h in range(24)],
        "pixels_per_hour": PIXELS_PER_HOUR,
        "label": label,
    }


def build_day_agenda(db: Session, the_date: date) -> list[CalendarEvent]:
    day_start = datetime.combine(the_date, time.min)
    day_end = datetime.combine(the_date, time.max)
    return (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= day_end, CalendarEvent.end_time >= day_start)
        .order_by(CalendarEvent.all_day.desc(), CalendarEvent.start_time)
        .all()
    )


def build_view_context(db: Session, view: str, anchor: date) -> dict:
    focus = anchor.isoformat()
    ctx = {
        "view": view,
        "focus_date": focus,
        "month_url": f"/calendar/month?date={focus}",
        "week_url": f"/calendar/week?date={focus}",
        "day_url": f"/calendar/day?date={focus}",
    }

    if view == "week":
        ctx["prev_url"] = f"/calendar/week?date={(anchor - timedelta(days=7)).isoformat()}"
        ctx["next_url"] = f"/calendar/week?date={(anchor + timedelta(days=7)).isoformat()}"
        ctx["today_url"] = f"/calendar/week?date={date.today().isoformat()}"
        ctx.update(build_week_view(db, anchor))
        ctx["partial"] = "_calendar_week.html"
    elif view == "day":
        ctx["prev_url"] = f"/calendar/day?date={(anchor - timedelta(days=1)).isoformat()}"
        ctx["next_url"] = f"/calendar/day?date={(anchor + timedelta(days=1)).isoformat()}"
        ctx["today_url"] = f"/calendar/day?date={date.today().isoformat()}"
        ctx["the_date"] = anchor
        ctx["events"] = build_day_agenda(db, anchor)
        ctx["partial"] = "_calendar_day.html"
    else:
        view = "month"
        ctx["view"] = view
        year, month = anchor.year, anchor.month
        prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
        next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
        ctx["prev_url"] = f"/calendar/month?date={date(prev_year, prev_month, 1).isoformat()}"
        ctx["next_url"] = f"/calendar/month?date={date(next_year, next_month, 1).isoformat()}"
        ctx["today_url"] = f"/calendar/month?date={date.today().isoformat()}"
        ctx["year"] = year
        ctx["month"] = month
        ctx["month_name"] = cal.month_name[month]
        ctx["grid"] = build_month_grid(db, year, month)
        ctx["partial"] = "_calendar_month.html"

    return ctx


@router.get("/calendar", response_class=HTMLResponse)
def calendar_page(
    request: Request,
    view: str = "month",
    date_param: str | None = Query(None, alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    anchor = date.fromisoformat(date_param) if date_param else date.today()
    if view not in {"month", "week", "day"}:
        view = "month"
    ctx = build_view_context(db, view, anchor)
    return templates.TemplateResponse(request, "calendar.html", {"current_user": current_user, **ctx})


@router.get("/calendar/month", response_class=HTMLResponse)
def calendar_month_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "month", date.fromisoformat(date_param))
    return templates.TemplateResponse(request, ctx["partial"], ctx)


@router.get("/calendar/week", response_class=HTMLResponse)
def calendar_week_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "week", date.fromisoformat(date_param))
    return templates.TemplateResponse(request, ctx["partial"], ctx)


@router.get("/calendar/day", response_class=HTMLResponse)
def calendar_day_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "day", date.fromisoformat(date_param))
    return templates.TemplateResponse(request, ctx["partial"], ctx)


@router.get("/calendar/new", response_class=HTMLResponse)
def calendar_new_form(
    request: Request,
    date_str: str,
    return_view: str = "month",
    return_date: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    members = db.query(User).order_by(User.display_name).all()
    return templates.TemplateResponse(
        request,
        "_event_form.html",
        {
            "event": None,
            "default_date": date_str,
            "members": members,
            "current_user": current_user,
            "return_view": return_view,
            "return_date": return_date or date_str,
        },
    )


@router.get("/calendar/events/{event_id}/edit", response_class=HTMLResponse)
def calendar_edit_form(
    request: Request,
    event_id: int,
    return_view: str = "month",
    return_date: str | None = None,
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
        {
            "event": event,
            "default_date": None,
            "members": members,
            "current_user": current_user,
            "return_view": return_view,
            "return_date": return_date or event.start_time.date().isoformat(),
        },
    )


def _return_response(request: Request, db: Session, return_view: str, return_date: str):
    anchor = date.fromisoformat(return_date)
    ctx = build_view_context(db, return_view, anchor)
    return templates.TemplateResponse(request, ctx["partial"], ctx)


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
    return_view: str = Form("month"),
    return_date: str = Form(...),
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
    return _return_response(request, db, return_view, return_date)


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
    return_view: str = Form("month"),
    return_date: str = Form(...),
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
    return _return_response(request, db, return_view, return_date)


@router.post("/calendar/events/{event_id}/delete", response_class=HTMLResponse)
def calendar_delete_event(
    request: Request,
    event_id: int,
    return_view: str = Form("month"),
    return_date: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    db.delete(event)
    db.commit()
    return _return_response(request, db, return_view, return_date)


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
