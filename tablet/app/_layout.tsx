import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { loadDisplayTimezone, loadTimeFormat, setAuthExpiredHandler, useTheme } from '../src/shared';

export default function RootLayout() {
  const { colors } = useTheme();
  const router = useRouter();

  // When the stored login stops working (password changed, account removed) the API client
  // gives up and wipes it; without this the screens would just sit there failing quietly.
  useEffect(() => {
    setAuthExpiredHandler(() => router.replace({ pathname: '/setup', params: { expired: '1' } }));
    return () => setAuthExpiredHandler(null);
  }, [router]);

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
