from datetime import date as date_cls, datetime, time, timedelta
from datetime import timezone as dt_timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.deps import get_device
from app.models import CalendarEvent, DeviceToken
from app.schemas import WidgetDayOut, WidgetEventOut, WidgetEventsOut
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


@router.get("/api/widget/events", response_model=WidgetEventsOut)
def widget_events(
    days: int = Query(7, ge=1, le=14),
    db: Session = Depends(get_db),
    device: DeviceToken = Depends(get_device),
):
    """Lean, pre-formatted day-grouped event feed for e-ink/frame widgets — no
    recurrence/attendee internals, times already rendered in the household's own
    timezone since these clients have no per-viewer timezone of their own (unlike
    the browser, which sends one via a cookie; see calendar.py's _viewer_tz)."""
    viewer_tz = settings.default_timezone
    today = to_local(datetime.now(dt_timezone.utc), viewer_tz).date()
    last_day = today + timedelta(days=days - 1)

    range_start = to_utc(datetime.combine(today, time.min), viewer_tz)
    range_end = to_utc(datetime.combine(last_day, time.max), viewer_tz)

    events = (
        db.query(CalendarEvent)
        .options(selectinload(CalendarEvent.attendees))
        .filter(CalendarEvent.start_time <= range_end, CalendarEvent.end_time >= range_start)
        .order_by(CalendarEvent.start_time)
        .all()
    )

    events_by_day: dict[date_cls, list[CalendarEvent]] = {}
    for event in events:
        start_local = to_local(event.start_time, viewer_tz)
        end_local = to_local(event.end_time, viewer_tz)
        first_day = max(start_local.date(), today)
        last = min(end_local.date(), last_day)
        day = first_day
        while day <= last:
            events_by_day.setdefault(day, []).append(event)
            day += timedelta(days=1)
    for day_events in events_by_day.values():
        day_events.sort(key=lambda e: (not e.all_day, e.start_time))

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
                events=[
                    WidgetEventOut(
                        title=e.title,
                        location=e.location,
                        time_label=_time_label(e, day, viewer_tz),
                        attendees=[a.display_name for a in e.attendees],
                    )
                    for e in events_by_day.get(day, [])
                ],
            )
        )

    return WidgetEventsOut(timezone=viewer_tz, days=day_list)
