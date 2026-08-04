import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../src/theme';
import { getLaunchOpensNotificationCenter, subscribeToNotificationTaps } from '../src/notifications';
import { loadDisplayTimezone, loadTimeFormat } from '../src/preferences';

// Import so TaskManager.defineTask() is called before any background event fires
import '../src/notifications';

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    // Kicked off as early as possible so the cached values (read synchronously via
    // getCachedDisplayTimezone() by dateUtils.ts, e.g. when the event form's initial
    // state is computed) reflect the stored preference instead of its default.
    loadDisplayTimezone();
    loadTimeFormat();
  }, []);

  useEffect(() => {
    getLaunchOpensNotificationCenter().then(shouldOpen => { if (shouldOpen) router.push('/notifications'); });
    const sub = subscribeToNotificationTaps(() => router.push('/notifications'));
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}
