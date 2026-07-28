import { ComponentProps, useEffect } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { setLastTab, type TabName } from '../../src/preferences';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const TAB_NAMES: readonly TabName[] = ['index', 'grocery', 'todo', 'freezer', 'settings'];

function icon(name: IoniconsName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const pathname = usePathname();

  useEffect(() => {
    const tab = pathname === '/' ? 'index' : pathname.replace(/^\//, '');
    if ((TAB_NAMES as readonly string[]).includes(tab)) {
      setLastTab(tab as TabName);
    }
  }, [pathname]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Calendar', tabBarIcon: icon('calendar-outline') }}
      />
      <Tabs.Screen
        name="grocery"
        options={{ title: 'Grocery', tabBarIcon: icon('cart-outline') }}
      />
      <Tabs.Screen
        name="todo"
        options={{ title: 'To-Do', tabBarIcon: icon('checkmark-circle-outline') }}
      />
      <Tabs.Screen
        name="freezer"
        options={{ title: 'Freezer', tabBarIcon: icon('snow-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }}
      />
    </Tabs>
  );
}
