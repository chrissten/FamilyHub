import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import type { CalendarEvent } from '../api/types';
import AttendeeDots from './AttendeeDots';
import { dateOnly, parseEventDate, type MonthDay, WEEKDAY_SHORT } from './dateUtils';
import { useTheme, type Colors } from '../theme';

const MAX_CHIPS = 3;

interface Props {
  grid: MonthDay[][];
  familySize: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAddEvent: (date: Date) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onSelectDay: (date: Date) => void;
}

/** Port of app/templates/_calendar_month.html adapted to a touch grid. */
export default function MonthView({
  grid, familySize, refreshing, onRefresh, onAddEvent, onEditEvent, onSelectDay,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.weekdayRow}>
        {WEEKDAY_SHORT.map(wd => (
          <Text key={wd} style={styles.weekdayLabel}>{wd}</Text>
        ))}
      </View>
      {grid.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map(day => {
            const shown = day.events.slice(0, MAX_CHIPS);
            const overflow = day.events.length - shown.length;
            return (
              <TouchableOpacity
                key={day.date.toISOString()}
                style={[styles.dayCell, !day.inMonth && styles.dayCellOut, day.isToday && styles.dayCellToday]}
                onPress={() => onSelectDay(day.date)}
                activeOpacity={0.7}
              >
                <View style={styles.dayCellHeader}>
                  <Text style={[
                    styles.dayNumber,
                    !day.inMonth && styles.dayNumberOut,
                    day.isToday && styles.dayNumberToday,
                  ]}>
                    {day.date.getDate()}
                  </Text>
                  <TouchableOpacity hitSlop={6} onPress={() => onAddEvent(day.date)}>
                    <Text style={styles.addBtn}>+</Text>
                  </TouchableOpacity>
                </View>
                {shown.map(event => {
                  const attendees = event.attendees.length ? event.attendees : [event.owner];
                  const continuesBefore = dateOnly(parseEventDate(event.start_time)).getTime() < day.date.getTime();
                  const continuesAfter = dateOnly(parseEventDate(event.end_time)).getTime() > day.date.getTime();
                  return (
                    <TouchableOpacity
                      key={event.id}
                      style={[
                        styles.chip,
                        continuesBefore && styles.chipContinuesBefore,
                        continuesAfter && styles.chipContinuesAfter,
                      ]}
                      onPress={() => onEditEvent(event)}
                    >
                      {!continuesBefore && <AttendeeDots attendees={attendees} familySize={familySize} />}
                      <Text style={styles.chipText} numberOfLines={1}>{event.title}</Text>
                    </TouchableOpacity>
                  );
                })}
                {overflow > 0 && <Text style={styles.moreText}>+{overflow} more</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { paddingBottom: 80 },
    weekdayRow: { flexDirection: 'row' },
    weekdayLabel: {
      flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600',
      color: colors.textFaint, paddingVertical: 6,
    },
    weekRow: { flexDirection: 'row' },
    dayCell: {
      flex: 1, minHeight: 92, borderWidth: 0.5, borderColor: colors.border,
      padding: 3, backgroundColor: colors.surface,
    },
    dayCellOut: { backgroundColor: colors.background },
    dayCellToday: { backgroundColor: colors.surfaceAlt },
    dayCellHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    dayNumber: { fontSize: 12, color: colors.textMuted, padding: 2 },
    dayNumberOut: { color: colors.placeholder },
    dayNumberToday: { color: colors.primary, fontWeight: '700' },
    addBtn: { fontSize: 14, color: colors.placeholder, paddingHorizontal: 4 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: colors.chip, borderRadius: 3,
      paddingHorizontal: 3, paddingVertical: 1, marginTop: 2,
    },
    chipContinuesBefore: {
      borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
      marginLeft: -3, paddingLeft: 1,
    },
    chipContinuesAfter: {
      borderTopRightRadius: 0, borderBottomRightRadius: 0,
      marginRight: -3, paddingRight: 1,
    },
    chipText: { fontSize: 9.5, color: colors.chipText, flexShrink: 1 },
    moreText: { fontSize: 9, color: colors.textFaint, marginTop: 1, paddingHorizontal: 2 },
  });
}
