import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, RefreshControl } from 'react-native';
import type { CalendarEvent } from '../api/types';
import AttendeeDots from './AttendeeDots';
import { dateOnly, fmtTime, parseEventDate } from './dateUtils';
import { useTimeFormat } from '../preferences';

function allDaySuffix(event: CalendarEvent): string {
  const start = dateOnly(parseEventDate(event.start_time));
  const end = dateOnly(parseEventDate(event.end_time));
  if (end.getTime() <= start.getTime()) return '';
  return ` (${start.getMonth() + 1}/${start.getDate()}–${end.getMonth() + 1}/${end.getDate()})`;
}

interface Props {
  events: CalendarEvent[];
  familySize: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAddEvent: () => void;
  onEditEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
}

/** Port of app/templates/_calendar_day.html. */
export default function DayAgenda({
  events, familySize, refreshing, onRefresh, onAddEvent, onEditEvent, onDeleteEvent,
}: Props) {
  const timeFormat = useTimeFormat();
  function confirmDelete(event: CalendarEvent) {
    Alert.alert('Delete Event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteEvent(event) },
    ]);
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addLink} onPress={onAddEvent}>
        <Text style={styles.addLinkText}>+ Add event</Text>
      </TouchableOpacity>
      <FlatList
        data={events}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const attendees = item.attendees.length ? item.attendees : [item.owner];
          const isAll = familySize > 1 && attendees.length >= familySize;
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => onEditEvent(item)}
              onLongPress={() => confirmDelete(item)}
              activeOpacity={0.7}
            >
              <View style={[styles.accent, { backgroundColor: attendees[0].color_hex }]} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTime}>
                  {item.all_day ? `All day${allDaySuffix(item)}` : `${fmtTime(item.start_time, timeFormat)} – ${fmtTime(item.end_time, timeFormat)}`}
                </Text>
                <View style={styles.titleRow}>
                  <AttendeeDots attendees={attendees} familySize={familySize} />
                  <Text style={styles.cardTitle}>{item.title}</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {isAll ? 'Everyone' : attendees.map(a => a.display_name).join(', ')}
                </Text>
                {!!item.location && <Text style={styles.cardMeta}>📍 {item.location}</Text>}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No events today</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  addLink: { paddingHorizontal: 16, paddingVertical: 10 },
  addLinkText: { color: '#4A90D9', fontWeight: '600', fontSize: 14 },
  list: { padding: 12, paddingBottom: 80 },
  card: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10,
    marginBottom: 8, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  accent: { width: 5 },
  cardBody: { flex: 1, padding: 12 },
  cardTime: { fontSize: 13, color: '#4A90D9' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  cardMeta: { fontSize: 12, color: '#888', marginTop: 3 },
  empty: { textAlign: 'center', color: '#bbb', marginTop: 80, fontSize: 16 },
});
