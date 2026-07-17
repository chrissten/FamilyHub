import os
from datetime import date, datetime, timedelta

from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")

_css_path = os.path.join("app", "static", "css", "app.css")
templates.env.globals["asset_version"] = str(int(os.path.getmtime(_css_path)))


def fmt_time(dt: datetime) -> str:
    hour12 = dt.hour % 12 or 12
    period = "AM" if dt.hour < 12 else "PM"
    return f"{hour12}:{dt.minute:02d} {period}"


_WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def event_tooltip_range(event) -> str:
    """Human-readable time range for a chip/block tooltip. Includes the weekday
    alongside each time when the event spans more than one calendar day, since a
    bare time range ("6:00 PM-12:00 PM") is ambiguous once start and end fall on
    different dates."""
    start, end = event.start_time, event.end_time
    if event.all_day:
        if end.date() > start.date():
            return f"All day ({start.month}/{start.day}–{end.month}/{end.day})"
        return "All day"
    if end.date() > start.date():
        return f"{_WEEKDAY_ABBR[start.weekday()]} {fmt_time(start)} – {_WEEKDAY_ABBR[end.weekday()]} {fmt_time(end)}"
    return f"{fmt_time(start)}–{fmt_time(end)}"


def event_time_label(event, day_date: date) -> str:
    """Time label for an agenda/day-list row representing `event` on `day_date`.
    For a timed event spanning multiple days, the raw start/end time only makes
    sense on the day it actually occurs; other days it spans just show as ongoing."""
    start, end = event.start_time, event.end_time
    if event.all_day:
        if end.date() > start.date():
            return f"All day ({start.month}/{start.day}–{end.month}/{end.day})"
        return "All day"
    if end.date() == start.date():
        return f"{fmt_time(start)} – {fmt_time(end)}"
    if day_date == start.date():
        return f"{fmt_time(start)} – continues"
    if day_date == end.date():
        return f"continues – {fmt_time(end)}"
    return "Continues all day"


def expiry_class(exp_date: date | None) -> str:
    if exp_date is None:
        return ""
    today = date.today()
    if exp_date < today:
        return "expired"
    if exp_date <= today + timedelta(days=7):
        return "expiring-soon"
    return ""


templates.env.filters["fmt_time"] = fmt_time
templates.env.filters["expiry_class"] = expiry_class
templates.env.filters["event_tooltip_range"] = event_tooltip_range
templates.env.filters["event_time_label"] = event_time_label
