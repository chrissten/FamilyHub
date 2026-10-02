import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect, type Href } from 'expo-router';
import { getSavedCredentials, getServerUrl, useTheme } from '../src/shared';
import { hasAdminPin } from '../src/settings';

/** Launch gate: first run goes through setup, every later launch straight to the week. */
export default function Index() {
  const { colors } = useTheme();
  const [target, setTarget] = useState<Href | null>(null);

  useEffect(() => {
    Promise.all([getServerUrl(), getSavedCredentials(), hasAdminPin()]).then(([url, creds, pin]) => {
      setTarget(url && creds && pin ? '/calendar' : '/setup');
    });
  }, []);

  if (!target) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return <Redirect href={target} />;
}
