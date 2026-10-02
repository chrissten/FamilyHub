import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { loadDisplayTimezone, loadTimeFormat, useTheme } from '../src/shared';

export default function RootLayout() {
  const { colors } = useTheme();

  useEffect(() => {
    // dateUtils reads these synchronously, so warm the caches before the calendar renders.
    loadDisplayTimezone();
    loadTimeFormat();
  }, []);

  return (
    <>
      {/* The status bar's pull-down is disabled while pinned anyway; hiding it gives the
          calendar the full screen. */}
      <StatusBar hidden />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}
