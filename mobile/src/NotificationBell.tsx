import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, type Colors } from './theme';
import { useNotificationCenter } from './notificationCenter';

export default function NotificationBell() {
  const { colors } = useTheme();
  const router = useRouter();
  const { unreadCount } = useNotificationCenter();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={() => router.push('/notifications')}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name={unreadCount > 0 ? 'notifications' : 'notifications-outline'} size={22} color="#fff" />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    button: { marginRight: 14, padding: 2 },
    badge: {
      position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16, borderRadius: 8,
      backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
    },
    badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  });
}
