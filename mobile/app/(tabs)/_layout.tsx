import { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

function icon(name: IoniconsName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
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
