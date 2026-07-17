import calendar as cal
from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import CalendarEvent, User
from app.recurrence import derive_rule_from_date, materialize_series
from app.schemas import EventCreate, EventOut
from app.templating import templates

router = APIRouter()


def build_month_grid(db: Session, year: int, month: int) -> list[list[dict]]:
    month_calendar = cal.Calendar(firstweekday=6)  # weeks start on Sunday
    weeks = month_calendar.monthdatescalendar(year, month)

    grid_start, grid_end = weeks[0][0], weeks[-1][-1]
    range_start = datetime.combine(grid_start, time.min)
    range_end = datetime.combine(grid_end, time.max)

    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )

    events_by_day: dict[date, list[CalendarEvent]] = {}
    for event in events:
        first_day = max(_naive(event.start_time).date(), grid_start)
        last_day = min(_naive(event.end_time).date(), grid_end)
        day = first_day
        while day <= last_day:
            events_by_day.setdefault(day, []).append(event)
            day += timedelta(days=1)
    for day_events in events_by_day.values():
        day_events.sort(key=lambda e: (not e.all_day, e.start_time))

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


def _naive(dt: datetime) -> datetime:
    """Strip tzinfo so comparisons work the same on Postgres (tz-aware) and SQLite (naive)."""
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def layout_day_blocks(events: list[CalendarEvent], day: date) -> list[dict]:
    """Greedy column layout for overlapping timed events within a single day."""
    day_start = datetime.combine(day, time.min)
    sorted_events = sorted(events, key=lambda e: e.start_time)

    columns_end: list[datetime] = []
    placements: list[tuple[CalendarEvent, int, datetime, datetime]] = []
    for event in sorted_events:
        ev_start = _naive(event.start_time)
        ev_end = _naive(event.end_time)
        placed_col = None
        for idx, col_end in enumerate(columns_end):
            if ev_start >= col_end:
                columns_end[idx] = ev_end
                placed_col = idx
                break
        if placed_col is None:
            columns_end.append(ev_end)
            placed_col = len(columns_end) - 1
        placements.append((event, placed_col, ev_start, ev_end))

    total_cols = len(columns_end) or 1
    blocks = []
    for event, col, ev_start, ev_end in placements:
        start_minutes = max(0.0, (ev_start - day_start).total_seconds() / 60)
        end_minutes = min(24 * 60.0, (ev_end - day_start).total_seconds() / 60)
        duration = max(end_minutes - start_minutes, 20.0)
        blocks.append(
            {
                "event": event,
                "top_hours": round(start_minutes / 60, 3),
                "height_hours": round(duration / 60, 3),
                "left_pct": round(col / total_cols * 100, 2),
                "width_pct": round(100 / total_cols, 2),
            }
        )
    return blocks


def build_multi_day_view(db: Session, day_dates: list[date]) -> dict:
    range_start = datetime.combine(day_dates[0], time.min)
    range_end = datetime.combine(day_dates[-1], time.max)
    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )

    days = []
    for day in day_dates:
        day_start = datetime.combine(day, time.min)
        day_end = datetime.combine(day, time.max)
        day_events = [e for e in events if _naive(e.start_time) <= day_end and _naive(e.end_time) >= day_start]
        days.append(
            {
                "date": day,
                "is_today": day == date.today(),
                "all_day_events": [e for e in day_events if e.all_day],
                "blocks": layout_day_blocks([e for e in day_events if not e.all_day], day),
            }
        )

    range_start_date, range_end_date = day_dates[0], day_dates[-1]
    if range_start_date.month == range_end_date.month:
        label = f"{cal.month_name[range_start_date.month]} {range_start_date.day}–{range_end_date.day}, {range_start_date.year}"
    elif range_start_date.year == range_end_date.year:
        label = (
            f"{cal.month_name[range_start_date.month]} {range_start_date.day} – "
            f"{cal.month_name[range_end_date.month]} {range_end_date.day}, {range_start_date.year}"
        )
    else:
        label = (
            f"{cal.month_name[range_start_date.month]} {range_start_date.day}, {range_start_date.year} – "
            f"{cal.month_name[range_end_date.month]} {range_end_date.day}, {range_end_date.year}"
        )

    return {
        "week_days": days,
        "hours": [(h, _hour_label(h)) for h in range(24)],
        "label": label,
    }


def build_agenda_view(db: Session, year: int, month: int) -> list[dict]:
    """List every day in the month (including days with no events), Cozi-style."""
    first_day = date(year, month, 1)
    last_day = date(year, month, cal.monthrange(year, month)[1])
    range_start = datetime.combine(first_day, time.min)
    range_end = datetime.combine(last_day, time.max)

    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )

    events_by_day: dict[date, list[CalendarEvent]] = {}
    for event in events:
        first = max(_naive(event.start_time).date(), first_day)
        last = min(_naive(event.end_time).date(), last_day)
        day = first
        while day <= last:
            events_by_day.setdefault(day, []).append(event)
            day += timedelta(days=1)
    for day_events in events_by_day.values():
        day_events.sort(key=lambda e: (not e.all_day, e.start_time))

    days = []
    day = first_day
    while day <= last_day:
        days.append(
            {
                "date": day,
                "is_today": day == date.today(),
                "events": events_by_day.get(day, []),
            }
        )
        day += timedelta(days=1)
    return days


def build_week_view(db: Session, anchor: date) -> dict:
    weekday_from_sunday = (anchor.weekday() + 1) % 7
    week_start = anchor - timedelta(days=weekday_from_sunday)
    week_dates = [week_start + timedelta(days=i) for i in range(7)]
    return build_multi_day_view(db, week_dates)


def build_three_day_view(db: Session, anchor: date) -> dict:
    day_dates = [anchor + timedelta(days=i) for i in range(3)]
    return build_multi_day_view(db, day_dates)


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
        "three_day_url": f"/calendar/3day?date={focus}",
        "day_url": f"/calendar/day?date={focus}",
        "agenda_url": f"/calendar/agenda?date={focus}",
        "family_size": db.query(User).count(),
    }

    if view == "agenda":
        year, month = anchor.year, anchor.month
        prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
        next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
        ctx["prev_url"] = f"/calendar/agenda?date={date(prev_year, prev_month, 1).isoformat()}"
        ctx["next_url"] = f"/calendar/agenda?date={date(next_year, next_month, 1).isoformat()}"
        ctx["today_url"] = f"/calendar/agenda?date={date.today().isoformat()}"
        ctx["year"] = year
        ctx["month"] = month
        ctx["month_name"] = cal.month_name[month]
        ctx["days"] = build_agenda_view(db, year, month)
        ctx["partial"] = "_calendar_agenda.html"
    elif view == "week":
        ctx["prev_url"] = f"/calendar/week?date={(anchor - timedelta(days=7)).isoformat()}"
        ctx["next_url"] = f"/calendar/week?date={(anchor + timedelta(days=7)).isoformat()}"
        ctx["today_url"] = f"/calendar/week?date={date.today().isoformat()}"
        ctx.update(build_week_view(db, anchor))
        ctx["partial"] = "_calendar_week.html"
    elif view == "3day":
        ctx["prev_url"] = f"/calendar/3day?date={(anchor - timedelta(days=3)).isoformat()}"
        ctx["next_url"] = f"/calendar/3day?date={(anchor + timedelta(days=3)).isoformat()}"
        ctx["today_url"] = f"/calendar/3day?date={date.today().isoformat()}"
        ctx.update(build_three_day_view(db, anchor))
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
    if view not in {"month", "week", "3day", "day", "agenda"}:
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


@router.get("/calendar/3day", response_class=HTMLResponse)
def calendar_three_day_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "3day", date.fromisoformat(date_param))
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


@router.get("/calendar/agenda", response_class=HTMLResponse)
def calendar_agenda_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "agenda", date.fromisoformat(date_param))
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


def _update_series(
    db: Session,
    series_id: str,
    *,
    title: str,
    description: str | None,
    location: str | None,
    all_day: bool,
    attendees: list[User],
    start_time_of_day: time,
    duration: timedelta,
) -> None:
    """Applies a "whole series" edit: title/description/location/all_day/attendees are
    overwritten on every occurrence, but only the time-of-day (not the date) is applied,
    so each occurrence keeps its own calendar date. The edited occurrence's duration
    (which may span multiple days) is preserved across every other occurrence."""
    rows = db.query(CalendarEvent).filter(CalendarEvent.series_id == series_id).all()
    for row in rows:
        row.title = title
        row.description = description
        row.location = location
        row.all_day = all_day
        row.attendees = attendees
        if not all_day:
            row.start_time = datetime.combine(row.start_time.date(), start_time_of_day)
            row.end_time = row.start_time + duration
    db.commit()


@router.post("/calendar/events", response_class=HTMLResponse)
def calendar_create_event(
    request: Request,
    title: str = Form(...),
    description: str = Form(""),
    location: str = Form(""),
    start_date: str = Form(...),
    end_date: str = Form(""),
    start_time_str: str = Form("09:00"),
    end_time_str: str = Form("10:00"),
    all_day: bool = Form(False),
    attendee_ids: list[int] = Form([]),
    repeat: str = Form("none"),
    return_view: str = Form("month"),
    return_date: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    day = date.fromisoformat(start_date)
    last_day = date.fromisoformat(end_date) if end_date else day
    if last_day < day:
        last_day = day
    if all_day:
        start_dt = datetime.combine(day, time.min)
        end_dt = datetime.combine(last_day, time.max)
    else:
        start_dt = datetime.combine(day, time.fromisoformat(start_time_str))
        end_dt = datetime.combine(last_day, time.fromisoformat(end_time_str))
        if end_dt < start_dt:
            end_dt = start_dt

    attendees = db.query(User).filter(User.id.in_(attendee_ids or [current_user.id])).all()

    if repeat in ("weekly", "monthly"):
        rule = derive_rule_from_date(repeat, day)
        materialize_series(
            db, current_user.id, title, description or None, location or None, all_day,
            attendees, rule, start_dt, end_dt,
        )
    else:
        event = CalendarEvent(
            owner_id=current_user.id,
            title=title,
            description=description or None,
            location=location or None,
            start_time=start_dt,
            end_time=end_dt,
            all_day=all_day,
        )
        event.attendees = attendees
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
    end_date: str = Form(""),
    start_time_str: str = Form("09:00"),
    end_time_str: str = Form("10:00"),
    all_day: bool = Form(False),
    attendee_ids: list[int] = Form([]),
    scope: str = Form("this"),
    return_view: str = Form("month"),
    return_date: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)

    day = date.fromisoformat(start_date)
    last_day = date.fromisoformat(end_date) if end_date else day
    if last_day < day:
        last_day = day
    if all_day:
        start_dt = datetime.combine(day, time.min)
        end_dt = datetime.combine(last_day, time.max)
    else:
        start_dt = datetime.combine(day, time.fromisoformat(start_time_str))
        end_dt = datetime.combine(last_day, time.fromisoformat(end_time_str))
        if end_dt < start_dt:
            end_dt = start_dt

    attendees = db.query(User).filter(User.id.in_(attendee_ids)).all()

    if scope == "series" and event.series_id:
        _update_series(
            db, event.series_id,
            title=title, description=description or None, location=location or None,
            all_day=all_day, attendees=attendees,
            start_time_of_day=start_dt.time(), duration=end_dt - start_dt,
        )
    else:
        event.title = title
        event.description = description or None
        event.location = location or None
        event.start_time = start_dt
        event.end_time = end_dt
        event.all_day = all_day
        event.attendees = attendees
        if event.series_id:
            event.series_id = None
            event.recurrence_rule = None
        db.commit()
    return _return_response(request, db, return_view, return_date)


@router.post("/calendar/events/{event_id}/delete", response_class=HTMLResponse)
def calendar_delete_event(
    request: Request,
    event_id: int,
    scope: str = Form("this"),
    return_view: str = Form("month"),
    return_date: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    if scope == "series" and event.series_id:
        for row in db.query(CalendarEvent).filter(CalendarEvent.series_id == event.series_id).all():
            db.delete(row)
    else:
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
    attendees = db.query(User).filter(User.id.in_(payload.attendee_ids or [current_user.id])).all()
    if payload.recurrence in ("weekly", "monthly"):
        rule = derive_rule_from_date(payload.recurrence, payload.start_time.date())
        events = materialize_series(
            db, current_user.id, payload.title, payload.description, payload.location,
            payload.all_day, attendees, rule, payload.start_time, payload.end_time,
        )
        return events[0]
    data = payload.model_dump(exclude={"attendee_ids", "recurrence"})
    event = CalendarEvent(owner_id=current_user.id, **data)
    event.attendees = attendees
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.put("/api/events/{event_id}", response_model=EventOut)
def api_update_event(
    event_id: int,
    payload: EventCreate,
    scope: Literal["this", "series"] = "this",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    attendees = db.query(User).filter(User.id.in_(payload.attendee_ids)).all()

    if scope == "series" and event.series_id:
        _update_series(
            db, event.series_id,
            title=payload.title, description=payload.description, location=payload.location,
            all_day=payload.all_day, attendees=attendees,
            start_time_of_day=payload.start_time.time(), duration=payload.end_time - payload.start_time,
        )
        db.refresh(event)
        return event

    event.title = payload.title
    event.description = payload.description
    event.location = payload.location
    event.start_time = payload.start_time
    event.end_time = payload.end_time
    event.all_day = payload.all_day
    event.attendees = attendees
    if event.series_id:
        event.series_id = None
        event.recurrence_rule = None
    db.commit()
    db.refresh(event)
    return event


@router.delete("/api/events/{event_id}")
def api_delete_event(
    event_id: int,
    scope: Literal["this", "series"] = "this",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)
    if scope == "series" and event.series_id:
        for row in db.query(CalendarEvent).filter(CalendarEvent.series_id == event.series_id).all():
            db.delete(row)
    else:
        db.delete(event)
    db.commit()
    return {"ok": True}
