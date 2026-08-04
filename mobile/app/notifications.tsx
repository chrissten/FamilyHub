import { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTheme, type Colors } from '../src/theme';
import { useNotificationCenter, type NotificationRecord } from '../src/notificationCenter';
import { openEventInForm } from '../src/calendar/formState';
import { dayLabel, eventTimeLabel, eventStart } from '../src/calendar/dateUtils';
import { useTimeFormat } from '../src/preferences';
import { getUsers } from '../src/api/client';
import AttendeeDots from '../src/calendar/AttendeeDots';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { records, unreadCount, markRead, markAllRead } = useNotificationCenter();
  const timeFormat = useTimeFormat();
  const [familySize, setFamilySize] = useState(0);

  useEffect(() => {
    getUsers().then(users => setFamilySize(users.length)).catch(() => {});
  }, []);

  async function handlePress(record: NotificationRecord) {
    await markRead(record.id);
    await openEventInForm(record.id, router);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Notifications',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          headerRight: () => (
            unreadCount > 0 ? (
              <TouchableOpacity onPress={() => markAllRead()}>
                <Text style={styles.markAllText}>Mark all read</Text>
              </TouchableOpacity>
            ) : null
          ),
        }}
      />
      <FlatList
        data={records}
        keyExtractor={r => String(r.id)}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => {
          const event = item.event;
          const start = eventStart(event);
          return (
            <TouchableOpacity
              style={[styles.row, event.conflict && styles.rowConflict]}
              onPress={() => handlePress(item)}
              activeOpacity={0.7}
            >
              {!item.read && <View style={styles.unreadDot} />}
              <View style={styles.rowBody}>
                <Text style={[styles.title, !item.read && styles.titleUnread]}>{event.title}</Text>
                <Text style={styles.time}>
                  {dayLabel(start)} · {eventTimeLabel(event, start, timeFormat)}
                </Text>
                {!!event.description && (
                  <Text style={styles.description} numberOfLines={2}>{event.description}</Text>
                )}
                {!!event.location && (
                  <Text style={styles.location} numberOfLines={1}>{event.location}</Text>
                )}
                <View style={styles.attendeeRow}>
                  <AttendeeDots attendees={event.attendees} familySize={familySize} />
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No new event notifications</Text>}
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    markAllText: { color: '#fff', fontWeight: '600', fontSize: 13, marginRight: 4 },
    row: {
      flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 10,
      padding: 14, marginBottom: 8, gap: 10,
      shadowColor: colors.shadow, shadowOpacity: 0.06, shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 }, elevation: 2,
    },
    rowConflict: { backgroundColor: colors.warningBg },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
    rowBody: { flex: 1, gap: 3 },
    title: { fontSize: 15, fontWeight: '500', color: colors.textMuted },
    titleUnread: { fontWeight: '700', color: colors.text },
    time: { fontSize: 13, color: colors.primary },
    description: { fontSize: 13, color: colors.textMuted },
    location: { fontSize: 12, color: colors.textFaint },
    attendeeRow: { marginTop: 4 },
    empty: { textAlign: 'center', color: colors.placeholder, marginTop: 60, fontSize: 15 },
  });
}
