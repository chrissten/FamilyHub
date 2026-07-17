import type { CalendarEvent } from '../api/types';
import type { TimeFormat } from '../preferences';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = dateOnly(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

export function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay());
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EVENT_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Parses an event's start_time/end_time as the literal wall-clock date/time it encodes,
 * ignoring any trailing UTC/offset marker. The backend (and the web app) store and render
 * these as plain wall-clock values — never converted through a real timezone — so this
 * must match that, rather than `new Date(iso)`, which would reinterpret the digits as a
 * true UTC instant and shift them by the device's real timezone offset.
 */
export function parseEventDate(dateStr: string): Date {
  const match = EVENT_DATE_RE.exec(dateStr);
  if (!match) return new Date(dateStr);
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function dayLabel(d: Date): string {
  return `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function rangeLabel(start: Date, end: Date): string {
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

export function formatClock(hours: number, minutes: number, format: TimeFormat = '12h'): string {
  const mm = String(minutes).padStart(2, '0');
  if (format === '24h') {
    return `${String(hours).padStart(2, '0')}:${mm}`;
  }
  const hour12 = hours % 12 || 12;
  const period = hours < 12 ? 'AM' : 'PM';
  return `${hour12}:${mm} ${period}`;
}

export function fmtTime(dateStr: string, format: TimeFormat = '12h'): string {
  const d = parseEventDate(dateStr);
  return formatClock(d.getHours(), d.getMinutes(), format);
}

/**
 * Port of event_time_label in app/templating.py — the time label for an agenda/day-list
 * row representing `event` on `day`. For a timed event spanning multiple days, the raw
 * start/end time only makes sense on the day it actually occurs; other days it spans just
 * show as ongoing.
 */
export function eventTimeLabel(event: CalendarEvent, day: Date, format: TimeFormat = '12h'): string {
  const start = parseEventDate(event.start_time);
  const end = parseEventDate(event.end_time);
  const startDay = dateOnly(start);
  const endDay = dateOnly(end);
  if (event.all_day) {
    if (endDay.getTime() > startDay.getTime()) {
      return `All day (${startDay.getMonth() + 1}/${startDay.getDate()}–${endDay.getMonth() + 1}/${endDay.getDate()})`;
    }
    return 'All day';
  }
  if (endDay.getTime() === startDay.getTime()) {
    return `${formatClock(start.getHours(), start.getMinutes(), format)} – ${formatClock(end.getHours(), end.getMinutes(), format)}`;
  }
  const day0 = dateOnly(day);
  if (day0.getTime() === startDay.getTime()) {
    return `${formatClock(start.getHours(), start.getMinutes(), format)} – continues`;
  }
  if (day0.getTime() === endDay.getTime()) {
    return `continues – ${formatClock(end.getHours(), end.getMinutes(), format)}`;
  }
  return 'Continues all day';
}

export function hourLabel(hour: number, format: TimeFormat = '12h'): string {
  if (format === '24h') return `${String(hour).padStart(2, '0')}:00`;
  const period = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 || 12;
  return `${hour12} ${period}`;
}
export const HOURS = Array.from({ length: 24 }, (_, h) => h);

export interface MonthDay {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

/** Port of build_month_grid in app/routers/calendar.py — Sunday-start weeks covering the month. */
export function buildMonthGrid(events: CalendarEvent[], year: number, month: number): MonthDay[][] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  const gridEnd = addDays(lastOfMonth, 6 - lastOfMonth.getDay());

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const eventStart = dateOnly(parseEventDate(e.start_time));
    const eventEnd = dateOnly(parseEventDate(e.end_time));
    const firstDay = eventStart.getTime() > gridStart.getTime() ? eventStart : gridStart;
    const lastDay = eventEnd.getTime() < gridEnd.getTime() ? eventEnd : gridEnd;
    for (let day = firstDay; day.getTime() <= lastDay.getTime(); day = addDays(day, 1)) {
      const key = dayKey(day);
      const bucket = eventsByDay.get(key);
      if (bucket) bucket.push(e);
      else eventsByDay.set(key, [e]);
    }
  }
  for (const dayEvents of eventsByDay.values()) {
    dayEvents.sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return parseEventDate(a.start_time).getTime() - parseEventDate(b.start_time).getTime();
    });
  }

  const weeks: MonthDay[][] = [];
  let cursor = gridStart;
  while (cursor.getTime() <= gridEnd.getTime()) {
    const week: MonthDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        date: cursor,
        inMonth: cursor.getMonth() === month,
        isToday: isToday(cursor),
        events: eventsByDay.get(dayKey(cursor)) ?? [],
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export interface DayBlock {
  event: CalendarEvent;
  topHours: number;
  heightHours: number;
  leftPct: number;
  widthPct: number;
}

/** Port of layout_day_blocks — greedy column layout for overlapping timed events within a single day. */
export function layoutDayBlocks(events: CalendarEvent[], day: Date): DayBlock[] {
  const dayStartMs = dateOnly(day).getTime();
  const sorted = [...events].sort(
    (a, b) => parseEventDate(a.start_time).getTime() - parseEventDate(b.start_time).getTime()
  );

  const columnsEnd: number[] = [];
  const placements: { event: CalendarEvent; col: number; start: number; end: number }[] = [];

  for (const event of sorted) {
    const start = parseEventDate(event.start_time).getTime();
    const end = parseEventDate(event.end_time).getTime();
    let placedCol = -1;
    for (let i = 0; i < columnsEnd.length; i++) {
      if (start >= columnsEnd[i]) {
        columnsEnd[i] = end;
        placedCol = i;
        break;
      }
    }
    if (placedCol === -1) {
      columnsEnd.push(end);
      placedCol = columnsEnd.length - 1;
    }
    placements.push({ event, col: placedCol, start, end });
  }

  const totalCols = columnsEnd.length || 1;
  return placements.map(({ event, col, start, end }) => {
    const startMinutes = Math.max(0, (start - dayStartMs) / 60000);
    const endMinutes = Math.min(24 * 60, (end - dayStartMs) / 60000);
    const duration = Math.max(endMinutes - startMinutes, 20);
    return {
      event,
      topHours: startMinutes / 60,
      heightHours: duration / 60,
      leftPct: (col / totalCols) * 100,
      widthPct: 100 / totalCols,
    };
  });
}

export interface DayColumn {
  date: Date;
  isToday: boolean;
  allDayEvents: CalendarEvent[];
  blocks: DayBlock[];
}

function overlapsDay(event: CalendarEvent, day: Date): boolean {
  const dayStart = dateOnly(day).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  const start = parseEventDate(event.start_time).getTime();
  const end = parseEventDate(event.end_time).getTime();
  return start <= dayEnd && end >= dayStart;
}

/** Port of build_multi_day_view — used for both the week (7 days) and 3-day views. */
export function buildMultiDayView(events: CalendarEvent[], dayDates: Date[]): DayColumn[] {
  return dayDates.map(day => {
    const dayEvents = events.filter(e => overlapsDay(e, day));
    return {
      date: day,
      isToday: isToday(day),
      allDayEvents: dayEvents.filter(e => e.all_day),
      blocks: layoutDayBlocks(dayEvents.filter(e => !e.all_day), day),
    };
  });
}

/** Port of build_day_agenda — events overlapping a single day, all-day first then by start time. */
export function buildDayAgenda(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter(e => overlapsDay(e, day))
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return parseEventDate(a.start_time).getTime() - parseEventDate(b.start_time).getTime();
    });
}

export interface AgendaDay {
  date: Date;
  isToday: boolean;
  events: CalendarEvent[];
}

/** Port of build_agenda_view — every day in the month, including days with no events. */
export function buildAgendaView(events: CalendarEvent[], year: number, month: number): AgendaDay[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const eventStart = dateOnly(parseEventDate(e.start_time));
    const eventEnd = dateOnly(parseEventDate(e.end_time));
    const firstDay = eventStart.getTime() > firstOfMonth.getTime() ? eventStart : firstOfMonth;
    const lastDay = eventEnd.getTime() < lastOfMonth.getTime() ? eventEnd : lastOfMonth;
    for (let day = firstDay; day.getTime() <= lastDay.getTime(); day = addDays(day, 1)) {
      const key = dayKey(day);
      const bucket = eventsByDay.get(key);
      if (bucket) bucket.push(e);
      else eventsByDay.set(key, [e]);
    }
  }
  for (const dayEvents of eventsByDay.values()) {
    dayEvents.sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return parseEventDate(a.start_time).getTime() - parseEventDate(b.start_time).getTime();
    });
  }

  const days: AgendaDay[] = [];
  let cursor = firstOfMonth;
  while (cursor.getTime() <= lastOfMonth.getTime()) {
    days.push({
      date: cursor,
      isToday: isToday(cursor),
      events: eventsByDay.get(dayKey(cursor)) ?? [],
    });
    cursor = addDays(cursor, 1);
  }
  return days;
}
