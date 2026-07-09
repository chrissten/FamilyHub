import type { CalendarEvent } from '../api/types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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

export function fmtTime(dateStr: string): string {
  const d = new Date(dateStr);
  const hour12 = d.getHours() % 12 || 12;
  const period = d.getHours() < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${period}`;
}

export function hourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 || 12;
  return `${hour12} ${period}`;
}
export const HOURS = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: hourLabel(h) }));

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
    const eventStart = dateOnly(new Date(e.start_time));
    const eventEnd = dateOnly(new Date(e.end_time));
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
      return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
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
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  const columnsEnd: number[] = [];
  const placements: { event: CalendarEvent; col: number; start: number; end: number }[] = [];

  for (const event of sorted) {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
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
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time).getTime();
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
      return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    });
}
