import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pref_theme_mode';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';

export interface Colors {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  shadow: string;
  placeholder: string;
  overlay: string;
  chip: string;
  chipText: string;
}

const lightColors: Colors = {
  background: '#f5f5f5',
  surface: '#ffffff',
  surfaceAlt: '#f5f5f5',
  text: '#1a1a1a',
  textMuted: '#666666',
  textFaint: '#999999',
  border: '#e8e8e8',
  primary: '#4A90D9',
  primaryText: '#ffffff',
  danger: '#d64545',
  dangerBg: '#fdecec',
  warning: '#8a6d1d',
  warningBg: '#fff3cd',
  shadow: '#000000',
  placeholder: '#bbbbbb',
  overlay: 'rgba(0,0,0,0.4)',
  chip: '#e4e7eb',
  chipText: '#1f2933',
};

const darkColors: Colors = {
  background: '#121212',
  surface: '#1e1e1e',
  surfaceAlt: '#2a2a2a',
  text: '#f0f0f0',
  textMuted: '#a8a8a8',
  textFaint: '#7d7d7d',
  border: '#333333',
  primary: '#5b9fe0',
  primaryText: '#ffffff',
  danger: '#e57373',
  dangerBg: '#3a2323',
  warning: '#e0c05a',
  warningBg: '#3a331a',
  shadow: '#000000',
  placeholder: '#6a6a6a',
  overlay: 'rgba(0,0,0,0.6)',
  chip: '#33383e',
  chipText: '#e6e9ec',
};

let cachedMode: ThemeMode = 'system';
const listeners = new Set<(mode: ThemeMode) => void>();

export async function loadThemeMode(): Promise<ThemeMode> {
  const stored = await AsyncStorage.getItem(KEY);
  cachedMode = stored === 'light' || stored === 'dark' ? stored : 'system';
  return cachedMode;
}

export async function setThemeMode(value: ThemeMode): Promise<void> {
  cachedMode = value;
  await AsyncStorage.setItem(KEY, value);
  listeners.forEach(listener => listener(value));
}

function useThemeModePref(): ThemeMode {
  const [mode, setMode] = useState(cachedMode);
  useEffect(() => {
    loadThemeMode().then(setMode);
    listeners.add(setMode);
    return () => { listeners.delete(setMode); };
  }, []);
  return mode;
}

/** Reactive theme: resolves 'system' against the OS color scheme, re-renders on Settings change. */
export function useTheme(): { colors: Colors; scheme: Scheme; mode: ThemeMode } {
  const mode = useThemeModePref();
  const systemScheme = useColorScheme();
  const scheme: Scheme = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  return { colors: scheme === 'dark' ? darkColors : lightColors, scheme, mode };
}
