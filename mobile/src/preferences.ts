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
