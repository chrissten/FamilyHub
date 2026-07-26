import os
from datetime import date, datetime, timedelta

from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")

_css_path = os.path.join("app", "static", "css", "app.css")
templates.env.globals["asset_version"] = str(int(os.path.getmtime(_css_path)))

_time_picker_js_path = os.path.join("app", "static", "js", "time-picker.js")
templates.env.globals["js_asset_version"] = str(int(os.path.getmtime(_time_picker_js_path)))


def fmt_time(dt: datetime) -> str:
    hour12 = dt.hour % 12 or 12
    period = "AM" if dt.hour < 12 else "PM"
    return f"{hour12}:{dt.minute:02d} {period}"


_WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _tz_suffixes(event) -> tuple[str, str]:
    """Start/end zone-abbreviation badge suffixes (each "" or " EST"-style) for an event,
    given the tz_label/end_tz_label set by _annotate_display. When the event's start and
    end share the same anchor zone (the common case), only the end gets a badge — matching
    the single trailing badge this app has always shown. When they genuinely differ (e.g. a
    flight landing in another zone), both ends get their own badge so the difference is
    visible in the rendered range."""
    end_tz_label = getattr(event, "end_tz_label", None)
    differs = bool(end_tz_label) and end_tz_label != event.tz_label
    start_suffix = f" {event.tz_label}" if event.tz_label and differs else ""
    end_suffix = f" {end_tz_label}" if differs else (f" {event.tz_label}" if event.tz_label else "")
    return start_suffix, end_suffix


def event_tooltip_range(event) -> str:
    """Human-readable time range for a chip/block tooltip. Includes the weekday
    alongside each time when the event spans more than one calendar day, since a
    bare time range ("6:00 PM-12:00 PM") is ambiguous once start and end fall on
    different dates. Uses the viewer-local display_start/display_end (see
    _annotate_display in routers/calendar.py) rather than the raw stored UTC instant,
    and appends a zone-abbreviation badge when the event was converted from a
    different timezone."""
    start, end = event.display_start, event.display_end
    if event.all_day:
        if end.date() > start.date():
            return f"All day ({start.month}/{start.day}–{end.month}/{end.day})"
        return "All day"
    start_suffix, end_suffix = _tz_suffixes(event)
    if end.date() > start.date():
        return f"{_WEEKDAY_ABBR[start.weekday()]} {fmt_time(start)}{start_suffix} – {_WEEKDAY_ABBR[end.weekday()]} {fmt_time(end)}{end_suffix}"
    return f"{fmt_time(start)}{start_suffix}–{fmt_time(end)}{end_suffix}"


def event_time_label(event, day_date: date) -> str:
    """Time label for an agenda/day-list row representing `event` on `day_date`.
    For a timed event spanning multiple days, the raw start/end time only makes
    sense on the day it actually occurs; other days it spans just show as ongoing.
    Uses the viewer-local display_start/display_end, with a zone-abbreviation badge
    when the event was converted from a different timezone."""
    start, end = event.display_start, event.display_end
    if event.all_day:
        if end.date() > start.date():
            return f"All day ({start.month}/{start.day}–{end.month}/{end.day})"
        return "All day"
    start_suffix, end_suffix = _tz_suffixes(event)
    if end.date() == start.date():
        return f"{fmt_time(start)}{start_suffix} – {fmt_time(end)}{end_suffix}"
    if day_date == start.date():
        return f"{fmt_time(start)}{start_suffix} – continues"
    if day_date == end.date():
        return f"continues – {fmt_time(end)}{end_suffix}"
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
