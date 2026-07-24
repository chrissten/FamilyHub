from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# Curated list shown in the timezone picker on both the web form and the mobile app —
# deliberately not the full ~600-zone IANA list, just the zones a US-based family is
# actually likely to need.
COMMON_TIMEZONES = [
    "Pacific/Honolulu",
    "America/Anchorage",
    "America/Los_Angeles",
    "America/Denver",
    "America/Phoenix",
    "America/Chicago",
    "America/New_York",
    "America/Puerto_Rico",
    "America/Halifax",
    "America/St_Johns",
    "America/Sao_Paulo",
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Athens",
    "Europe/Moscow",
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Asia/Jerusalem",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Bangkok",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Sydney",
    "Australia/Perth",
    "Pacific/Auckland",
]


def _as_utc(dt: datetime) -> datetime:
    """Normalizes a datetime read back from the DB to an aware UTC instant. Postgres
    hands back tz-aware values; SQLite hands back naive ones that are still, by
    convention, UTC (see CalendarEvent.start_time/end_time) — this makes both look
    the same to callers."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_utc(wall_clock: datetime, tz_name: str) -> datetime:
    """Interprets a naive wall-clock datetime as local time in `tz_name` and returns
    the corresponding aware UTC instant."""
    return wall_clock.replace(tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc)


def to_local(instant: datetime, tz_name: str) -> datetime:
    """Converts a UTC instant to a naive wall-clock datetime in `tz_name`."""
    return _as_utc(instant).astimezone(ZoneInfo(tz_name)).replace(tzinfo=None)


def tz_abbr(instant: datetime, tz_name: str) -> str:
    """Short zone abbreviation (e.g. "EDT") for `instant` as observed in `tz_name`,
    for a badge next to a converted time."""
    return _as_utc(instant).astimezone(ZoneInfo(tz_name)).tzname() or tz_name
