import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, RefreshControl } from 'react-native';
import type { CalendarEvent } from '../api/types';
import AttendeeDots from './AttendeeDots';
import { AgendaDay, MONTH_NAMES, WEEKDAY_NAMES, dateOnly, fmtTime, parseEventDate } from './dateUtils';
import { useTimeFormat } from '../preferences';

function allDaySuffix(event: CalendarEvent): string {
  const start = dateOnly(parseEventDate(event.start_time));
  const end = dateOnly(parseEventDate(event.end_time));
  if (end.getTime() <= start.getTime()) return '';
  return ` (${start.getMonth() + 1}/${start.getDate()}–${end.getMonth() + 1}/${end.getDate()})`;
}

interface Props {
  days: AgendaDay[];
  familySize: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAddEvent: (date: Date) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
}

/** Port of app/templates/_calendar_agenda.html — a scrolling list of every day in the month. */
export default function AgendaView({
  days, familySize, refreshing, onRefresh, onAddEvent, onEditEvent, onDeleteEvent,
}: Props) {
  const timeFormat = useTimeFormat();
  function confirmDelete(event: CalendarEvent) {
    Alert.alert('Delete Event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteEvent(event) },
    ]);
  }

  return (
    <FlatList
      data={days}
      keyExtractor={item => item.date.toISOString()}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item: day }) => (
        <View style={styles.day}>
          <View style={styles.dayHeader}>
            <View style={styles.dayLabel}>
              <Text style={[styles.dayWeekday, day.isToday && styles.dayToday]}>
                {WEEKDAY_NAMES[day.date.getDay()]}
              </Text>
              <Text style={[styles.dayDate, day.isToday && styles.dayToday]}>
                {MONTH_NAMES[day.date.getMonth()].slice(0, 3)} {day.date.getDate()}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onAddEvent(day.date)} hitSlop={8}>
              <Text style={styles.addLink}>+</Text>
            </TouchableOpacity>
          </View>

          {day.events.length === 0 ? (
            <Text style={styles.empty}>Nothing scheduled</Text>
          ) : (
            day.events.map(item => {
              const attendees = item.attendees.length ? item.attendees : [item.owner];
              const isAll = familySize > 1 && attendees.length >= familySize;
              return (
                <TouchableOpacity
                  key={item.id}
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
            })
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, paddingBottom: 80 },
  day: { marginBottom: 14 },
  dayHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
  dayLabel: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dayWeekday: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  dayDate: { fontSize: 13, color: '#666' },
  dayToday: { color: '#4A90D9' },
  addLink: { color: '#4A90D9', fontWeight: '700', fontSize: 16, paddingHorizontal: 6 },
  empty: { color: '#bbb', fontSize: 13, fontStyle: 'italic' },
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
});
