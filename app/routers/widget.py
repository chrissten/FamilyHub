import calendar as cal
from datetime import date as date_cls, datetime, time, timedelta
from datetime import timezone as dt_timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.deps import get_device
from app.models import CalendarEvent, DeviceToken
from app.schemas import WidgetDayOut, WidgetEventOut, WidgetEventsOut, WidgetGridDayOut, WidgetGridOut
from app.templating import fmt_time
from app.timezones import to_local, to_utc

router = APIRouter()

_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _time_label(event: CalendarEvent, day: date_cls, viewer_tz: str) -> str:
    start = to_local(event.start_time, viewer_tz)
    end = to_local(event.end_time, viewer_tz)
    if event.all_day:
        if end.date() > start.date():
            return f"All day ({start.month}/{start.day}–{end.month}/{end.day})"
        return "All day"
    if end.date() == start.date():
        return f"{fmt_time(start)} – {fmt_time(end)}"
    if day == start.date():
        return f"{fmt_time(start)} – continues"
    if day == end.date():
        return f"continues – {fmt_time(end)}"
    return "Continues all day"


def _widget_event_out(event: CalendarEvent, day: date_cls, viewer_tz: str) -> WidgetEventOut:
    return WidgetEventOut(
        title=event.title,
        location=event.location,
        time_label=_time_label(event, day, viewer_tz),
        attendees=[a.display_name for a in event.attendees],
    )


def _events_by_day(
    db: Session, viewer_tz: str, range_start: date_cls, range_end: date_cls
) -> dict[date_cls, list[CalendarEvent]]:
    """Queries events overlapping [range_start, range_end] (inclusive, household-local
    calendar days) and buckets each into every day it touches, clipped to the range —
    same overlap/clip semantics as calendar.py's build_month_grid."""
    utc_start = to_utc(datetime.combine(range_start, time.min), viewer_tz)
    utc_end = to_utc(datetime.combine(range_end, time.max), viewer_tz)

    events = (
        db.query(CalendarEvent)
        .options(selectinload(CalendarEvent.attendees))
        .filter(CalendarEvent.start_time <= utc_end, CalendarEvent.end_time >= utc_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )

    events_by_day: dict[date_cls, list[CalendarEvent]] = {}
    for event in events:
        first_day = max(to_local(event.start_time, viewer_tz).date(), range_start)
        last_day = min(to_local(event.end_time, viewer_tz).date(), range_end)
        day = first_day
        while day <= last_day:
            events_by_day.setdefault(day, []).append(event)
            day += timedelta(days=1)
    for day_events in events_by_day.values():
        day_events.sort(key=lambda e: (not e.all_day, e.start_time))
    return events_by_day


@router.get("/api/widget/events", response_model=WidgetEventsOut)
def widget_events(
    days: int = Query(7, ge=1, le=14),
    db: Session = Depends(get_db),
    device: DeviceToken = Depends(get_device),
):
    """Lean, pre-formatted day-grouped event feed for the list-style e-ink widget — no
    recurrence internals, times already rendered in the household's own timezone since
    these clients have no per-viewer timezone of their own (unlike the browser, which
    sends one via a cookie; see calendar.py's _viewer_tz)."""
    viewer_tz = settings.default_timezone
    today = to_local(datetime.now(dt_timezone.utc), viewer_tz).date()
    last_day = today + timedelta(days=days - 1)
    events_by_day = _events_by_day(db, viewer_tz, today, last_day)

    day_list = []
    for i in range(days):
        day = today + timedelta(days=i)
        if i == 0:
            label = "Today"
        elif i == 1:
            label = "Tomorrow"
        else:
            label = _DAY_LABELS[day.weekday()]
        day_list.append(
            WidgetDayOut(
                date=day,
                label=label,
                events=[_widget_event_out(e, day, viewer_tz) for e in events_by_day.get(day, [])],
            )
        )

    return WidgetEventsOut(timezone=viewer_tz, days=day_list)


@router.get("/api/widget/grid", response_model=WidgetGridOut)
def widget_grid(
    view: Literal["week", "month"] = Query("week"),
    db: Session = Depends(get_db),
    device: DeviceToken = Depends(get_device),
):
    """Tabular feed for the grid-style e-ink widget: a week (Sunday-Saturday, matching
    the web app's week-starts-on-Sunday convention) or the whole current calendar month
    as weeks-of-days, each day carrying its own event list."""
    viewer_tz = settings.default_timezone
    today = to_local(datetime.now(dt_timezone.utc), viewer_tz).date()

    if view == "week":
        week_start = today - timedelta(days=(today.weekday() + 1) % 7)
        week_dates = [[week_start + timedelta(days=i) for i in range(7)]]
    else:
        week_dates = cal.Calendar(firstweekday=6).monthdatescalendar(today.year, today.month)

    grid_start, grid_end = week_dates[0][0], week_dates[-1][-1]
    events_by_day = _events_by_day(db, viewer_tz, grid_start, grid_end)

    weeks_out = [
        [
            WidgetGridDayOut(
                date=day,
                weekday=_DAY_LABELS[day.weekday()],
                in_month=(view != "month" or day.month == today.month),
                is_today=(day == today),
                events=[_widget_event_out(e, day, viewer_tz) for e in events_by_day.get(day, [])],
            )
            for day in week
        ]
        for week in week_dates
    ]

    return WidgetGridOut(timezone=viewer_tz, view=view, weeks=weeks_out)
