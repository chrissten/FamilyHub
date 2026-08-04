import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalendarEvent } from './api/types';

const KEY = 'notif_center_records';
const CAP = 50;

export interface NotificationRecord {
  /** = event.id. poll_last_event_id only advances forward, so a given event can
   * produce at most one record ever — safe to reuse as the record key. */
  id: number;
  /** Snapshot of the event at notification time, so the list renders with no refetch. */
  event: CalendarEvent;
  read: boolean;
  createdAt: string;
}

let cached: NotificationRecord[] = [];
const listeners = new Set<(records: NotificationRecord[]) => void>();

function notify() {
  listeners.forEach(listener => listener(cached));
}

export async function loadNotificationRecords(): Promise<NotificationRecord[]> {
  const stored = await AsyncStorage.getItem(KEY);
  cached = stored ? JSON.parse(stored) : [];
  return cached;
}

/** Called from checkNewEvents() with the batch of newly-detected events. Reads the
 * on-disk list fresh rather than trusting `cached` — the background-fetch task runs in
 * a cold JS context each time, so `cached` can't be assumed warm there. */
export async function addNotificationRecords(events: CalendarEvent[]): Promise<void> {
  const stored = await AsyncStorage.getItem(KEY);
  const existing: NotificationRecord[] = stored ? JSON.parse(stored) : [];

  const createdAt = new Date().toISOString();
  const additions: NotificationRecord[] = [...events]
    .sort((a, b) => b.id - a.id)
    .map(event => ({ id: event.id, event, read: false, createdAt }));

  cached = [...additions, ...existing].slice(0, CAP);
  await AsyncStorage.setItem(KEY, JSON.stringify(cached));
  notify();
}

export async function markRead(id: number): Promise<void> {
  cached = cached.map(r => (r.id === id ? { ...r, read: true } : r));
  await AsyncStorage.setItem(KEY, JSON.stringify(cached));
  notify();
}

export async function markAllRead(): Promise<void> {
  cached = cached.map(r => (r.read ? r : { ...r, read: true }));
  await AsyncStorage.setItem(KEY, JSON.stringify(cached));
  notify();
}

export function useNotificationCenter(): {
  records: NotificationRecord[];
  unreadCount: number;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
} {
  const [records, setRecords] = useState(cached);
  useEffect(() => {
    loadNotificationRecords().then(setRecords);
    listeners.add(setRecords);
    return () => { listeners.delete(setRecords); };
  }, []);
  return {
    records,
    unreadCount: records.filter(r => !r.read).length,
    markRead,
    markAllRead,
  };
}
