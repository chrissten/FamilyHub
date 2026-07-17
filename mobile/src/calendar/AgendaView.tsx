import { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, RefreshControl } from 'react-native';
import type { CalendarEvent } from '../api/types';
import AttendeeDots from './AttendeeDots';
import { AgendaDay, MONTH_NAMES, WEEKDAY_NAMES, dateOnly, fmtTime, parseEventDate } from './dateUtils';
import { useTimeFormat } from '../preferences';
import { useTheme, type Colors } from '../theme';

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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listRef = useRef<FlatList<AgendaDay>>(null);
  const monthKey = days[0] ? `${days[0].date.getFullYear()}-${days[0].date.getMonth()}` : '';

  useEffect(() => {
    const todayIndex = days.findIndex(d => d.isToday);
    if (todayIndex <= 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: todayIndex, animated: false, viewPosition: 0 });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  function confirmDelete(event: CalendarEvent) {
    Alert.alert('Delete Event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteEvent(event) },
    ]);
  }

  return (
    <FlatList
      ref={listRef}
      data={days}
      keyExtractor={item => item.date.toISOString()}
      contentContainerStyle={styles.list}
      initialNumToRender={days.length}
      onScrollToIndexFailed={info => {
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 });
        }, 100);
      }}
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
                    <View style={styles.titleRow}>
                      <Text style={styles.cardTime}>
                        {item.all_day ? `All day${allDaySuffix(item)}` : `${fmtTime(item.start_time, timeFormat)} – ${fmtTime(item.end_time, timeFormat)}`}
                      </Text>
                      <AttendeeDots attendees={attendees} familySize={familySize} />
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {item.title}{item.series_id ? ' ↻' : ''}
                      </Text>
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

function createStyles(colors: Colors) {
  return StyleSheet.create({
    list: { padding: 12, paddingBottom: 80 },
    day: { marginBottom: 14 },
    dayHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
    dayLabel: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    dayWeekday: { fontSize: 15, fontWeight: '700', color: colors.text },
    dayDate: { fontSize: 13, color: colors.textMuted },
    dayToday: { color: colors.primary },
    addLink: { color: colors.primary, fontWeight: '700', fontSize: 16, paddingHorizontal: 6 },
    empty: { color: colors.placeholder, fontSize: 13, fontStyle: 'italic' },
    card: {
      flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 10,
      marginBottom: 8, overflow: 'hidden',
      shadowColor: colors.shadow, shadowOpacity: 0.06, shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 }, elevation: 2,
    },
    accent: { width: 5 },
    cardBody: { flex: 1, padding: 12 },
    cardTime: { fontSize: 13, color: colors.primary },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
    cardMeta: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
  });
}
