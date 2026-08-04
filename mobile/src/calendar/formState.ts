import type { useRouter } from 'expo-router';
import type { CalendarEvent, User } from '../api/types';
import { getEvents, getUsers } from '../api/client';

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

/** Fetches the current version of `eventId` (not a possibly-stale snapshot) and
 * navigates to the edit form, stashing it via setPendingEventForm above. */
export async function openEventInForm(eventId: number, router: ReturnType<typeof useRouter>): Promise<void> {
  try {
    const [events, members] = await Promise.all([getEvents(), getUsers()]);
    const event = events.find(e => e.id === eventId);
    if (!event) return; // deleted since, or not logged in — nothing to open
    setPendingEventForm({ event, defaultDate: '', members });
    router.push('/event-form');
  } catch {
    // not logged in yet, or a transient fetch failure — nothing to open
  }
}
