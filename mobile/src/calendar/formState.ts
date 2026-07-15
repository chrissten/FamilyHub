import type { CalendarEvent, User } from '../api/types';

export interface PendingEventForm {
  event: CalendarEvent | null;
  defaultDate: string;
  members: User[];
}

let pending: PendingEventForm | null = null;

/** Stashes the data the event-form route needs before navigating to it — the route
 *  itself has no other way to receive non-serializable props (an event with nested
 *  attendees, the members list) through expo-router's URL-based params. */
export function setPendingEventForm(payload: PendingEventForm): void {
  pending = payload;
}

export function takePendingEventForm(): PendingEventForm | null {
  const value = pending;
  pending = null;
  return value;
}
