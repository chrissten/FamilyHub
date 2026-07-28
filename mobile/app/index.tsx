import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { getToken, getSavedCredentials, getServerUrl, login } from '../src/api/client';
import { ensureDefaultNotifPrefs } from '../src/notifications';
import { loadLastTab } from '../src/preferences';

async function replaceToLastTab(router: ReturnType<typeof useRouter>) {
  const tab = await loadLastTab();
  router.replace(tab === 'index' ? '/(tabs)' : `/(tabs)/${tab}`);
}

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        await ensureDefaultNotifPrefs();
        await replaceToLastTab(router);
        return;
      }
      const creds = await getSavedCredentials();
      if (creds) {
        try {
          const url = await getServerUrl();
          await login(url, creds.username, creds.password);
          await ensureDefaultNotifPrefs();
          await replaceToLastTab(router);
          return;
        } catch {
          // saved credentials are stale; fall through to login screen
        }
      }
      router.replace('/login');
    })();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#4A90D9' }}>
      <ActivityIndicator color="#fff" size="large" />
    </View>
  );
}
