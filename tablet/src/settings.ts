import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'admin_pin';

export async function hasAdminPin(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(PIN_KEY));
}

export async function setAdminPin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, pin);
}

export async function checkAdminPin(pin: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN_KEY)) === pin;
}

export const PIN_PATTERN = /^\d{4,8}$/;

// ── Boolean toggles (AsyncStorage, with a tiny subscription so screens stay in sync) ──

type Toggle = 'kiosk_enabled' | 'keep_awake';
// Kiosk lock starts off: a grown-up turns it on from settings once the tablet is set up.
const DEFAULTS: Record<Toggle, boolean> = { kiosk_enabled: false, keep_awake: true };
const cache: Partial<Record<Toggle, boolean>> = {};
const listeners = new Set<() => void>();

export async function getToggle(key: Toggle): Promise<boolean> {
  if (cache[key] === undefined) {
    const raw = await AsyncStorage.getItem(`pref_${key}`);
    cache[key] = raw === null ? DEFAULTS[key] : raw === '1';
  }
  return cache[key]!;
}

export async function setToggle(key: Toggle, value: boolean): Promise<void> {
  cache[key] = value;
  listeners.forEach(l => l());
  await AsyncStorage.setItem(`pref_${key}`, value ? '1' : '0');
}

export function useToggle(key: Toggle): boolean {
  const [value, setValue] = useState(cache[key] ?? DEFAULTS[key]);
  useEffect(() => {
    const refresh = () => { getToggle(key).then(setValue); };
    refresh();
    listeners.add(refresh);
    return () => { listeners.delete(refresh); };
  }, [key]);
  return value;
}
