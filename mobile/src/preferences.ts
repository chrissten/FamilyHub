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
