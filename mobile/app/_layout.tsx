import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Import so TaskManager.defineTask() is called before any background event fires
import '../src/notifications';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
