import { WEEKDAY_NAMES } from './dateUtils';

/** Mirrors app/recurrence.py's derive_rule_from_date — the "Repeat" picker never asks for a
 *  weekday/ordinal separately, it always computes "Weekly on Tuesday" / "Monthly on the 3rd
 *  Thursday" from whatever start date the user already picked. */
export function weekdayLabel(d: Date): string {
  return WEEKDAY_NAMES[d.getDay()];
}

export function monthlyLabel(d: Date): string {
  const day = d.getDate();
  const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const isLast = day + 7 > lastDayOfMonth;
  const ordinal = isLast ? 'last' : ['1st', '2nd', '3rd', '4th'][Math.floor((day - 1) / 7)];
  return `${ordinal} ${weekdayLabel(d)}`;
}
