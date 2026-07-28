import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pref_time_format';

export type TimeFormat = '12h' | '24h';

let cached: TimeFormat = '12h';
const listeners = new Set<(value: TimeFormat) => void>();

export async function loadTimeFormat(): Promise<TimeFormat> {
  const stored = await AsyncStorage.getItem(KEY);
  cached = stored === '24h' ? '24h' : '12h';
  return cached;
}

export async function setTimeFormat(value: TimeFormat): Promise<void> {
  cached = value;
  await AsyncStorage.setItem(KEY, value);
  listeners.forEach(listener => listener(value));
}

/** Reactive time-format preference; re-renders subscribers when settings changes it. */
export function useTimeFormat(): TimeFormat {
  const [format, setFormat] = useState(cached);
  useEffect(() => {
    loadTimeFormat().then(setFormat);
    listeners.add(setFormat);
    return () => { listeners.delete(setFormat); };
  }, []);
  return format;
}

const TZ_KEY = 'pref_display_timezone';

/** null means "use the device's current timezone" (the default). A non-null value
 * pins event display to that IANA zone regardless of where the device actually is. */
let cachedTz: string | null = null;
const tzListeners = new Set<(value: string | null) => void>();

export async function loadDisplayTimezone(): Promise<string | null> {
  cachedTz = await AsyncStorage.getItem(TZ_KEY);
  return cachedTz;
}

export async function setDisplayTimezone(value: string | null): Promise<void> {
  cachedTz = value;
  if (value) await AsyncStorage.setItem(TZ_KEY, value);
  else await AsyncStorage.removeItem(TZ_KEY);
  tzListeners.forEach(listener => listener(value));
}

/** Synchronous read of the last-loaded/set value, for non-component code (dateUtils.ts)
 * that can't use the hook below. Defaults to null until loadDisplayTimezone() has run
 * once, same "flash of default" tradeoff as `cached` above. */
export function getCachedDisplayTimezone(): string | null {
  return cachedTz;
}

/** Reactive display-timezone preference; re-renders subscribers when settings changes it. */
export function useDisplayTimezone(): string | null {
  const [tz, setTz] = useState(cachedTz);
  useEffect(() => {
    loadDisplayTimezone().then(setTz);
    tzListeners.add(setTz);
    return () => { tzListeners.delete(setTz); };
  }, []);
  return tz;
}

const LAST_TAB_KEY = 'pref_last_tab';
const TABS = ['index', 'grocery', 'todo', 'freezer', 'settings'] as const;
export type TabName = typeof TABS[number];

/** Which bottom tab the user last had open, so relaunching the app returns them to it. */
export async function loadLastTab(): Promise<TabName> {
  const stored = await AsyncStorage.getItem(LAST_TAB_KEY);
  return (TABS as readonly string[]).includes(stored ?? '') ? (stored as TabName) : 'index';
}

export async function setLastTab(value: TabName): Promise<void> {
  await AsyncStorage.setItem(LAST_TAB_KEY, value);
}

const LAST_CALENDAR_VIEW_KEY = 'pref_last_calendar_view';
const CALENDAR_VIEWS = ['month', 'week', '3day', 'day', 'agenda'] as const;
export type CalendarViewKind = typeof CALENDAR_VIEWS[number];

/** Which calendar sub-view (Month/Week/3 Day/Day/Agenda) was last selected. */
export async function loadLastCalendarView(): Promise<CalendarViewKind> {
  const stored = await AsyncStorage.getItem(LAST_CALENDAR_VIEW_KEY);
  return (CALENDAR_VIEWS as readonly string[]).includes(stored ?? '') ? (stored as CalendarViewKind) : 'month';
}

export async function setLastCalendarView(value: CalendarViewKind): Promise<void> {
  await AsyncStorage.setItem(LAST_CALENDAR_VIEW_KEY, value);
}
