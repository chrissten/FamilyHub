import calendar as cal
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import CalendarEvent, User

HORIZON_MONTHS = 24
TOPUP_THRESHOLD_MONTHS = 18
MAX_OCCURRENCES = 260


class RecurrenceRule(BaseModel):
    freq: Literal["weekly", "monthly"]
    weekday: int  # 0=Sunday..6=Saturday, matching build_week_view's Sunday-start convention
    week_of_month: int | None = None  # 1-4, or -1 for "last"; only meaningful when freq == "monthly"


def _weekday_sunday0(d: date) -> int:
    return (d.weekday() + 1) % 7


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, cal.monthrange(year, month)[1])
    return date(year, month, day)


def derive_rule_from_date(freq: Literal["weekly", "monthly"], start_date: date) -> RecurrenceRule:
    """Derives the weekday (and, for monthly, the ordinal week) implied by an event's own
    start date — the UI never asks for these separately, it always shows "Weekly on Tuesday"
    or "Monthly on the 3rd Thursday" computed from whatever date the user already picked."""
    weekday = _weekday_sunday0(start_date)
    week_of_month = None
    if freq == "monthly":
        week_of_month = (start_date.day - 1) // 7 + 1
        last_day_of_month = cal.monthrange(start_date.year, start_date.month)[1]
        if start_date.day + 7 > last_day_of_month:
            week_of_month = -1
    return RecurrenceRule(freq=freq, weekday=weekday, week_of_month=week_of_month)


def _nth_weekday_of_month(year: int, month: int, weekday: int, week_of_month: int) -> date | None:
    last_day = cal.monthrange(year, month)[1]
    matches = [
        date(year, month, day)
        for day in range(1, last_day + 1)
        if _weekday_sunday0(date(year, month, day)) == weekday
    ]
    if not matches:
        return None
    if week_of_month == -1:
        return matches[-1]
    if 1 <= week_of_month <= len(matches):
        return matches[week_of_month - 1]
    return None


def generate_dates(rule: RecurrenceRule, first_date: date, until_date: date, cap: int = MAX_OCCURRENCES) -> list[date]:
    dates: list[date] = []
    if rule.freq == "weekly":
        cursor = first_date
        while cursor <= until_date and len(dates) < cap:
            dates.append(cursor)
            cursor += timedelta(days=7)
        return dates

    year, month = first_date.year, first_date.month
    while len(dates) < cap and date(year, month, 1) <= until_date:
        occ = _nth_weekday_of_month(year, month, rule.weekday, rule.week_of_month or -1)
        if occ and first_date <= occ <= until_date:
            dates.append(occ)
        month += 1
        if month > 12:
            month = 1
            year += 1
    return dates


def materialize_series(
    db: Session,
    owner_id: int,
    title: str,
    description: str | None,
    location: str | None,
    all_day: bool,
    attendees: list[User],
    rule: RecurrenceRule,
    first_start: datetime,
    first_end: datetime,
    until: date | None = None,
) -> list[CalendarEvent]:
    """`until` is the user-chosen end date for the series (None means "repeats forever").
    A bounded series is materialized in full immediately (capped by MAX_OCCURRENCES); an
    unbounded one only gets HORIZON_MONTHS worth of rows and is topped up over time by
    top_up_recurring_series."""
    duration = first_end - first_start
    boundary = until if until else _add_months(first_start.date(), HORIZON_MONTHS)
    dates = generate_dates(rule, first_start.date(), boundary)
    if not dates:
        dates = [first_start.date()]

    series_id = str(uuid4())
    rule_json = rule.model_dump_json()
    events = []
    for d in dates:
        start_dt = datetime.combine(d, first_start.time())
        event = CalendarEvent(
            owner_id=owner_id,
            title=title,
            description=description,
            location=location,
            start_time=start_dt,
            end_time=start_dt + duration,
            all_day=all_day,
            recurrence_rule=rule_json,
            series_id=series_id,
            series_until=until,
        )
        event.attendees = attendees
        db.add(event)
        events.append(event)
    db.commit()
    for event in events:
        db.refresh(event)
    return events


def _extend_series(db: Session, series_id: str, target_until: date) -> None:
    """Generates additional occurrences for a series from its current last occurrence up to
    (and including) target_until, using the most recent occurrence as the template for
    title/description/location/attendees/duration."""
    template = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.series_id == series_id)
        .order_by(CalendarEvent.start_time.desc())
        .first()
    )
    if not template or not template.recurrence_rule:
        return
    last_date = template.start_time.date()
    if last_date >= target_until:
        return

    rule = RecurrenceRule.model_validate_json(template.recurrence_rule)
    duration = template.end_time - template.start_time
    next_after = last_date + (timedelta(days=7) if rule.freq == "weekly" else timedelta(days=1))
    new_dates = generate_dates(rule, next_after, target_until)
    attendees = list(template.attendees)
    for d in new_dates:
        start_dt = datetime.combine(d, template.start_time.time())
        event = CalendarEvent(
            owner_id=template.owner_id,
            title=template.title,
            description=template.description,
            location=template.location,
            start_time=start_dt,
            end_time=start_dt + duration,
            all_day=template.all_day,
            recurrence_rule=template.recurrence_rule,
            series_id=series_id,
            series_until=template.series_until,
        )
        event.attendees = attendees
        db.add(event)


def update_series_until(db: Session, series_id: str, new_until: date | None, min_until: date | None = None) -> None:
    """Applies a new end date to an existing series: trims occurrences past the new
    boundary, extends them if the boundary moved out, and stores the new boundary (or
    None, meaning "repeats forever" again) on every remaining row. `min_until` — the date
    of whichever occurrence the caller is editing — is a floor: an end date earlier than
    the very occurrence being saved would delete it out from under the caller, so it gets
    clamped up to that date instead."""
    rows = db.query(CalendarEvent).filter(CalendarEvent.series_id == series_id).all()
    if not rows:
        return
    if new_until is not None and min_until is not None and new_until < min_until:
        new_until = min_until
    for row in rows:
        row.series_until = new_until
    db.commit()

    if new_until is not None:
        for row in rows:
            if row.start_time.date() > new_until:
                db.delete(row)
        db.commit()
        _extend_series(db, series_id, new_until)
    else:
        _extend_series(db, series_id, _add_months(date.today(), HORIZON_MONTHS))
    db.commit()


def top_up_recurring_series(db: Session) -> None:
    """Keeps 'repeats forever' series materialized ~HORIZON_MONTHS out. Run at app startup
    (deploys happen often enough for this project that a cron job isn't needed) — for any
    unbounded series whose last occurrence is getting close (within TOPUP_THRESHOLD_MONTHS),
    generates more rows out to the full horizon. Bounded series (series_until is set) are
    materialized in full up front and never topped up."""
    today = date.today()
    horizon = _add_months(today, HORIZON_MONTHS)
    threshold = _add_months(today, TOPUP_THRESHOLD_MONTHS)

    rows = (
        db.query(CalendarEvent.series_id, func.max(CalendarEvent.start_time))
        .filter(CalendarEvent.series_id.isnot(None))
        .group_by(CalendarEvent.series_id)
        .all()
    )
    for series_id, last_start in rows:
        if last_start is None:
            continue
        last_date = last_start.date()
        if last_date >= threshold:
            continue

        template = (
            db.query(CalendarEvent)
            .filter(CalendarEvent.series_id == series_id)
            .order_by(CalendarEvent.start_time.desc())
            .first()
        )
        if not template or not template.recurrence_rule or template.series_until:
            continue
        _extend_series(db, series_id, horizon)
    db.commit()
