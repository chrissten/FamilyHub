import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../src/theme';
import { getLaunchNotificationEventId, subscribeToNotificationTaps } from '../src/notifications';
import { getEvents, getUsers } from '../src/api/client';
import { setPendingEventForm } from '../src/calendar/formState';
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
    async function openEvent(eventId: number) {
      try {
        const [events, members] = await Promise.all([getEvents(), getUsers()]);
        const event = events.find(e => e.id === eventId);
        if (!event) return;
        setPendingEventForm({ event, defaultDate: '', members });
        router.push('/event-form');
      } catch {
        // not logged in yet, or the event was since deleted — nothing to open
      }
    }

    getLaunchNotificationEventId().then(id => { if (id != null) openEvent(id); });
    const sub = subscribeToNotificationTaps(openEvent);
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}
