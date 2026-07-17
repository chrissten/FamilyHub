import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, RefreshControl } from 'react-native';
import type { CalendarEvent } from '../api/types';
import AttendeeDots from './AttendeeDots';
import { eventTimeLabel } from './dateUtils';
import { useTimeFormat } from '../preferences';
import { useTheme, type Colors } from '../theme';

interface Props {
  events: CalendarEvent[];
  theDate: Date;
  familySize: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAddEvent: () => void;
  onEditEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
}

/** Port of app/templates/_calendar_day.html. */
export default function DayAgenda({
  events, theDate, familySize, refreshing, onRefresh, onAddEvent, onEditEvent, onDeleteEvent,
}: Props) {
  const timeFormat = useTimeFormat();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
                <View style={styles.titleRow}>
                  <Text style={styles.cardTime}>
                    {eventTimeLabel(item, theDate, timeFormat)}
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
        }}
        ListEmptyComponent={<Text style={styles.empty}>No events today</Text>}
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    addLink: { paddingHorizontal: 16, paddingVertical: 10 },
    addLinkText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
    list: { padding: 12, paddingBottom: 80 },
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
    empty: { textAlign: 'center', color: colors.placeholder, marginTop: 80, fontSize: 16 },
  });
}
