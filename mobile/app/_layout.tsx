import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useShareIntent } from 'expo-share-intent';
import { useTheme } from '../src/theme';
import { getLaunchOpensNotificationCenter, subscribeToNotificationTaps } from '../src/notifications';
import { loadDisplayTimezone, loadTimeFormat } from '../src/preferences';
import { setPendingShare, shareIntentToSource } from '../src/recipes/shareIntake';

// Import so TaskManager.defineTask() is called before any background event fires
import '../src/notifications';

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });

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

  // "Share -> FamilyHub" from a browser or the Facebook app lands here. Handled at the
  // root because the share can arrive cold-start or while the app is already open, on
  // whatever screen happened to be showing. The payload is stashed rather than passed
  // as a route param, since picked image descriptors don't survive a URL.
  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;
    const source = shareIntentToSource(shareIntent);
    resetShareIntent();
    if (!source) return;
    setPendingShare(source);
    router.push('/recipe-import');
  }, [hasShareIntent, shareIntent]);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}
