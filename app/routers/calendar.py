import calendar as cal
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from typing import Literal
from urllib.parse import unquote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import CalendarEvent, User
from app.recurrence import RecurrenceRule, derive_rule_from_date, materialize_series, update_series_until
from app.schemas import EventCreate, EventOut
from app.templating import templates
from app.timezones import COMMON_TIMEZONES, to_local, to_utc, tz_abbr

router = APIRouter()


def _viewer_tz(request: Request) -> str:
    """The timezone to render times in for this request: a cookie set client-side (see
    the inline script in base.html) from Intl.DateTimeFormat, falling back to the
    configured default (first request, or JS disabled)."""
    raw = request.cookies.get("tz")
    if not raw:
        return settings.default_timezone
    # http.cookies (used by Starlette) doesn't URL-decode values, but the cookie is
    # set client-side with encodeURIComponent (e.g. "America/Chicago" -> "America%2FChicago").
    tz_name = unquote(raw)
    try:
        ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return settings.default_timezone
    return tz_name


def _annotate_display(events: list[CalendarEvent], viewer_tz: str) -> None:
    """Attaches transient (unpersisted) display_start/display_end/tz_label/end_tz_label to
    each event: the viewer-local wall-clock time to render, and zone-abbreviation badges
    when those differ from the event's own anchor zone(s). All-day events bypass conversion
    entirely — they're pure UTC calendar-date boundaries, and converting through an offset
    could roll the date across a day boundary."""
    for event in events:
        if event.all_day:
            event.display_start = event.start_time.replace(tzinfo=None)
            event.display_end = event.end_time.replace(tzinfo=None)
            event.tz_label = None
            event.end_tz_label = None
            continue
        event.display_start = to_local(event.start_time, viewer_tz)
        event.display_end = to_local(event.end_time, viewer_tz)
        event_tz = event.timezone or settings.default_timezone
        end_event_tz = event.end_timezone or event_tz
        event.tz_label = tz_abbr(event.start_time, viewer_tz) if event_tz != viewer_tz else None
        event.end_tz_label = tz_abbr(event.end_time, viewer_tz) if end_event_tz != viewer_tz else None


def build_month_grid(db: Session, year: int, month: int, viewer_tz: str) -> list[list[dict]]:
    month_calendar = cal.Calendar(firstweekday=6)  # weeks start on Sunday
    weeks = month_calendar.monthdatescalendar(year, month)

    grid_start, grid_end = weeks[0][0], weeks[-1][-1]
    range_start = to_utc(datetime.combine(grid_start, time.min), viewer_tz)
    range_end = to_utc(datetime.combine(grid_end, time.max), viewer_tz)

    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )
    _annotate_display(events, viewer_tz)

    events_by_day: dict[date, list[CalendarEvent]] = {}
    for event in events:
        first_day = max(event.display_start.date(), grid_start)
        last_day = min(event.display_end.date(), grid_end)
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


def layout_day_blocks(events: list[CalendarEvent], day: date) -> list[dict]:
    """Greedy column layout for overlapping timed events within a single day. Expects
    events already annotated with display_start/display_end (see _annotate_display)."""
    day_start = datetime.combine(day, time.min)
    sorted_events = sorted(events, key=lambda e: e.start_time)

    columns_end: list[datetime] = []
    placements: list[tuple[CalendarEvent, int, datetime, datetime]] = []
    for event in sorted_events:
        ev_start = event.display_start
        ev_end = event.display_end
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


def build_multi_day_view(db: Session, day_dates: list[date], viewer_tz: str) -> dict:
    range_start = to_utc(datetime.combine(day_dates[0], time.min), viewer_tz)
    range_end = to_utc(datetime.combine(day_dates[-1], time.max), viewer_tz)
    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )
    _annotate_display(events, viewer_tz)

    days = []
    for day in day_dates:
        day_start = datetime.combine(day, time.min)
        day_end = datetime.combine(day, time.max)
        day_events = [e for e in events if e.display_start <= day_end and e.display_end >= day_start]
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


def build_agenda_view(db: Session, year: int, month: int, viewer_tz: str) -> list[dict]:
    """List every day in the month (including days with no events), Cozi-style."""
    first_day = date(year, month, 1)
    last_day = date(year, month, cal.monthrange(year, month)[1])
    range_start = to_utc(datetime.combine(first_day, time.min), viewer_tz)
    range_end = to_utc(datetime.combine(last_day, time.max), viewer_tz)

    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )
    _annotate_display(events, viewer_tz)

    events_by_day: dict[date, list[CalendarEvent]] = {}
    for event in events:
        first = max(event.display_start.date(), first_day)
        last = min(event.display_end.date(), last_day)
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


def build_week_view(db: Session, anchor: date, viewer_tz: str) -> dict:
    weekday_from_sunday = (anchor.weekday() + 1) % 7
    week_start = anchor - timedelta(days=weekday_from_sunday)
    week_dates = [week_start + timedelta(days=i) for i in range(7)]
    return build_multi_day_view(db, week_dates, viewer_tz)


def build_three_day_view(db: Session, anchor: date, viewer_tz: str) -> dict:
    day_dates = [anchor + timedelta(days=i) for i in range(3)]
    return build_multi_day_view(db, day_dates, viewer_tz)


def build_day_agenda(db: Session, the_date: date, viewer_tz: str) -> list[CalendarEvent]:
    day_start = to_utc(datetime.combine(the_date, time.min), viewer_tz)
    day_end = to_utc(datetime.combine(the_date, time.max), viewer_tz)
    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.start_time <= day_end, CalendarEvent.end_time >= day_start)
        .order_by(CalendarEvent.all_day.desc(), CalendarEvent.start_time)
        .all()
    )
    _annotate_display(events, viewer_tz)
    return events


def build_view_context(db: Session, view: str, anchor: date, request: Request) -> dict:
    viewer_tz = _viewer_tz(request)
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
        ctx["days"] = build_agenda_view(db, year, month, viewer_tz)
        ctx["partial"] = "_calendar_agenda.html"
    elif view == "week":
        ctx["prev_url"] = f"/calendar/week?date={(anchor - timedelta(days=7)).isoformat()}"
        ctx["next_url"] = f"/calendar/week?date={(anchor + timedelta(days=7)).isoformat()}"
        ctx["today_url"] = f"/calendar/week?date={date.today().isoformat()}"
        ctx.update(build_week_view(db, anchor, viewer_tz))
        ctx["partial"] = "_calendar_week.html"
    elif view == "3day":
        ctx["prev_url"] = f"/calendar/3day?date={(anchor - timedelta(days=3)).isoformat()}"
        ctx["next_url"] = f"/calendar/3day?date={(anchor + timedelta(days=3)).isoformat()}"
        ctx["today_url"] = f"/calendar/3day?date={date.today().isoformat()}"
        ctx.update(build_three_day_view(db, anchor, viewer_tz))
        ctx["partial"] = "_calendar_week.html"
    elif view == "day":
        ctx["prev_url"] = f"/calendar/day?date={(anchor - timedelta(days=1)).isoformat()}"
        ctx["next_url"] = f"/calendar/day?date={(anchor + timedelta(days=1)).isoformat()}"
        ctx["today_url"] = f"/calendar/day?date={date.today().isoformat()}"
        ctx["the_date"] = anchor
        ctx["events"] = build_day_agenda(db, anchor, viewer_tz)
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
        ctx["grid"] = build_month_grid(db, year, month, viewer_tz)
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
    request.session["last_page"] = f"/calendar?view={view}" if view != "month" else "/calendar"
    ctx = build_view_context(db, view, anchor, request)
    return templates.TemplateResponse(request, "calendar.html", {"current_user": current_user, **ctx})


@router.get("/calendar/month", response_class=HTMLResponse)
def calendar_month_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "month", date.fromisoformat(date_param), request)
    return templates.TemplateResponse(request, ctx["partial"], ctx)


@router.get("/calendar/week", response_class=HTMLResponse)
def calendar_week_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "week", date.fromisoformat(date_param), request)
    return templates.TemplateResponse(request, ctx["partial"], ctx)


@router.get("/calendar/3day", response_class=HTMLResponse)
def calendar_three_day_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "3day", date.fromisoformat(date_param), request)
    return templates.TemplateResponse(request, ctx["partial"], ctx)


@router.get("/calendar/day", response_class=HTMLResponse)
def calendar_day_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "day", date.fromisoformat(date_param), request)
    return templates.TemplateResponse(request, ctx["partial"], ctx)


@router.get("/calendar/agenda", response_class=HTMLResponse)
def calendar_agenda_view(
    request: Request,
    date_param: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ctx = build_view_context(db, "agenda", date.fromisoformat(date_param), request)
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
            "default_end_date": date_str,
            "default_title": "",
            "default_description": "",
            "default_location": "",
            "default_all_day": False,
            "default_start_time": "09:00",
            "default_end_time": "10:00",
            "default_timezone": _viewer_tz(request),
            "default_end_timezone": _viewer_tz(request),
            "timezones": COMMON_TIMEZONES,
            "default_attendee_ids": [current_user.id],
            "members": members,
            "current_user": current_user,
            "return_view": return_view,
            "return_date": return_date or date_str,
        },
    )


@router.get("/calendar/events/{event_id}/duplicate", response_class=HTMLResponse)
def calendar_duplicate_form(
    request: Request,
    event_id: int,
    return_view: str = "month",
    return_date: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Opens the "new event" form pre-filled with an existing event's details. The duplicate
    is always created as a standalone, non-repeating event — it doesn't join the source
    event's series, so the user picks a fresh repeat rule if they want one."""
    source = db.get(CalendarEvent, event_id)
    if not source:
        raise HTTPException(status_code=404)
    members = db.query(User).order_by(User.display_name).all()
    source_tz = source.timezone or settings.default_timezone
    source_end_tz = source.end_timezone or source_tz
    if source.all_day:
        local_start, local_end = source.start_time, source.end_time
    else:
        local_start, local_end = to_local(source.start_time, source_tz), to_local(source.end_time, source_end_tz)
    return templates.TemplateResponse(
        request,
        "_event_form.html",
        {
            "event": None,
            "default_date": local_start.date().isoformat(),
            "default_end_date": local_end.date().isoformat(),
            "default_title": source.title,
            "default_description": source.description or "",
            "default_location": source.location or "",
            "default_all_day": source.all_day,
            "default_start_time": local_start.strftime("%H:%M"),
            "default_end_time": local_end.strftime("%H:%M"),
            "default_timezone": source_tz,
            "default_end_timezone": source_end_tz,
            "timezones": COMMON_TIMEZONES,
            "default_attendee_ids": [a.id for a in source.attendees],
            "members": members,
            "current_user": current_user,
            "return_view": return_view,
            "return_date": return_date or local_start.date().isoformat(),
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
    event_freq = None
    if event.recurrence_rule:
        event_freq = RecurrenceRule.model_validate_json(event.recurrence_rule).freq
    event_tz = event.timezone or settings.default_timezone
    event_end_tz = event.end_timezone or event_tz
    if event.all_day:
        local_start, local_end = event.start_time, event.end_time
    else:
        local_start, local_end = to_local(event.start_time, event_tz), to_local(event.end_time, event_end_tz)
    return templates.TemplateResponse(
        request,
        "_event_form.html",
        {
            "event": event,
            "event_freq": event_freq,
            "default_date": local_start.date().isoformat(),
            "default_end_date": local_end.date().isoformat(),
            "default_start_time": local_start.strftime("%H:%M"),
            "default_end_time": local_end.strftime("%H:%M"),
            "default_timezone": event_tz,
            "default_end_timezone": event_end_tz,
            "timezones": COMMON_TIMEZONES,
            "members": members,
            "current_user": current_user,
            "return_view": return_view,
            "return_date": return_date or local_start.date().isoformat(),
        },
    )


def _return_response(request: Request, db: Session, return_view: str, return_date: str):
    anchor = date.fromisoformat(return_date)
    ctx = build_view_context(db, return_view, anchor, request)
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
    timezone: str,
    end_timezone: str | None = None,
) -> None:
    """Applies a "whole series" edit: title/description/location/all_day/attendees/
    timezone are overwritten on every occurrence, but only the time-of-day (not the
    date) is applied, so each occurrence keeps its own calendar date — read via each
    row's *current* timezone before it gets overwritten below. The edited occurrence's
    duration (which may span multiple days) is preserved across every other occurrence."""
    end_tz = end_timezone or timezone
    rows = db.query(CalendarEvent).filter(CalendarEvent.series_id == series_id).all()
    for row in rows:
        row.title = title
        row.description = description
        row.location = location
        row.all_day = all_day
        row.attendees = attendees
        if not all_day:
            old_tz = row.timezone or timezone
            local_date = to_local(row.start_time, old_tz).date()
            naive_start = datetime.combine(local_date, start_time_of_day)
            row.start_time = to_utc(naive_start, timezone)
            row.end_time = to_utc(naive_start + duration, end_tz)
        row.timezone = timezone
        row.end_timezone = end_timezone
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
    timezone: str = Form(...),
    end_timezone: str = Form(""),
    conflict: bool = Form(False),
    attendee_ids: list[int] = Form([]),
    repeat: str = Form("none"),
    repeat_until_mode: str = Form("never"),
    repeat_until: str = Form(""),
    return_view: str = Form("month"),
    return_date: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    end_timezone = end_timezone or None
    if end_timezone == timezone:
        end_timezone = None
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
        until = date.fromisoformat(repeat_until) if repeat_until_mode == "on" and repeat_until else None
        rule = derive_rule_from_date(repeat, day)
        materialize_series(
            db, current_user.id, title, description or None, location or None, all_day,
            attendees, rule, start_dt, end_dt, timezone, until=until, end_timezone=end_timezone,
        )
    else:
        if all_day:
            start_time, end_time = start_dt.replace(tzinfo=dt_timezone.utc), end_dt.replace(tzinfo=dt_timezone.utc)
        else:
            start_time, end_time = to_utc(start_dt, timezone), to_utc(end_dt, end_timezone or timezone)
        event = CalendarEvent(
            owner_id=current_user.id,
            title=title,
            description=description or None,
            location=location or None,
            start_time=start_time,
            end_time=end_time,
            all_day=all_day,
            timezone=timezone,
            end_timezone=end_timezone,
            conflict=conflict,
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
    timezone: str = Form(...),
    end_timezone: str = Form(""),
    conflict: bool = Form(False),
    attendee_ids: list[int] = Form([]),
    scope: str = Form("this"),
    repeat_until_mode: str = Form("never"),
    repeat_until: str = Form(""),
    return_view: str = Form("month"),
    return_date: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404)

    end_timezone = end_timezone or None
    if end_timezone == timezone:
        end_timezone = None

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
            timezone=timezone, end_timezone=end_timezone,
        )
        until = date.fromisoformat(repeat_until) if repeat_until_mode == "on" and repeat_until else None
        update_series_until(db, event.series_id, until, min_until=start_dt.date())
    else:
        if all_day:
            start_time, end_time = start_dt.replace(tzinfo=dt_timezone.utc), end_dt.replace(tzinfo=dt_timezone.utc)
        else:
            start_time, end_time = to_utc(start_dt, timezone), to_utc(end_dt, end_timezone or timezone)
        event.title = title
        event.description = description or None
        event.location = location or None
        event.start_time = start_time
        event.end_time = end_time
        event.all_day = all_day
        event.timezone = timezone
        event.end_timezone = end_timezone
        event.conflict = conflict
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
            payload.timezone, until=payload.recurrence_until, end_timezone=payload.end_timezone,
        )
        return events[0]
    if payload.all_day:
        start_time = payload.start_time.replace(tzinfo=dt_timezone.utc)
        end_time = payload.end_time.replace(tzinfo=dt_timezone.utc)
    else:
        start_time = to_utc(payload.start_time, payload.timezone)
        end_time = to_utc(payload.end_time, payload.end_timezone or payload.timezone)
    data = payload.model_dump(exclude={"attendee_ids", "recurrence", "recurrence_until", "start_time", "end_time"})
    event = CalendarEvent(owner_id=current_user.id, **data, start_time=start_time, end_time=end_time)
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
            timezone=payload.timezone, end_timezone=payload.end_timezone,
        )
        update_series_until(db, event.series_id, payload.recurrence_until, min_until=payload.start_time.date())
        db.refresh(event)
        return event

    if payload.all_day:
        event.start_time = payload.start_time.replace(tzinfo=dt_timezone.utc)
        event.end_time = payload.end_time.replace(tzinfo=dt_timezone.utc)
    else:
        event.start_time = to_utc(payload.start_time, payload.timezone)
        event.end_time = to_utc(payload.end_time, payload.end_timezone or payload.timezone)
    event.title = payload.title
    event.description = payload.description
    event.location = payload.location
    event.all_day = payload.all_day
    event.timezone = payload.timezone
    event.end_timezone = payload.end_timezone
    if "conflict" in payload.model_fields_set:
        # Older mobile clients built before this field existed never send it, so their
        # JSON omits "conflict" entirely — falling back to the schema default (False)
        # here would silently clear a flag someone else set from a newer client.
        event.conflict = payload.conflict
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
