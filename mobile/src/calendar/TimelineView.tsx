import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import type { CalendarEvent } from '../api/types';
import AttendeeDots from './AttendeeDots';
import { dateOnly, parseEventDate, type DayColumn, HOURS, WEEKDAY_SHORT, hourLabel } from './dateUtils';
import { useTimeFormat } from '../preferences';
import { useTheme, type Colors } from '../theme';

const HOUR_HEIGHT = 50;
const TIME_COL_WIDTH = 42;

interface Props {
  days: DayColumn[];
  familySize: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAddEvent: (date: Date) => void;
  onEditEvent: (event: CalendarEvent) => void;
}

/** Shared Week / 3-Day timeline, port of app/templates/_calendar_week.html. */
export default function TimelineView({ days, familySize, refreshing, onRefresh, onAddEvent, onEditEvent }: Props) {
  const timeFormat = useTimeFormat();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ width: TIME_COL_WIDTH }} />
        {days.map(day => (
          <View key={day.date.toISOString()} style={[styles.dayHeader, day.isToday && styles.today]}>
            <Text style={styles.dayHeaderWeekday}>{WEEKDAY_SHORT[day.date.getDay()]}</Text>
            <Text style={[styles.dayHeaderDate, day.isToday && styles.todayText]}>
              {day.date.getMonth() + 1}/{day.date.getDate()}
            </Text>
            <TouchableOpacity hitSlop={6} onPress={() => onAddEvent(day.date)}>
              <Text style={styles.addBtn}>+</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.allDayRow}>
        <View style={{ width: TIME_COL_WIDTH }}>
          <Text style={styles.timeLabelSmall}>All day</Text>
        </View>
        {days.map(day => (
          <View key={day.date.toISOString()} style={styles.allDayCell}>
            {day.allDayEvents.map(event => {
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
          </View>
        ))}
      </View>

      <ScrollView
        style={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.bodyRow}>
          <View style={{ width: TIME_COL_WIDTH }}>
            {HOURS.map(h => (
              <View key={h} style={styles.hourRow}>
                <Text style={styles.hourLabel}>{hourLabel(h, timeFormat)}</Text>
              </View>
            ))}
          </View>
          {days.map(day => (
            <View key={day.date.toISOString()} style={[styles.dayCol, day.isToday && styles.today]}>
              {HOURS.map(h => <View key={h} style={styles.hourRow} />)}
              {day.blocks.map(block => {
                const attendees = block.event.attendees.length ? block.event.attendees : [block.event.owner];
                const continuesBefore = dateOnly(parseEventDate(block.event.start_time)).getTime() < day.date.getTime();
                const continuesAfter = dateOnly(parseEventDate(block.event.end_time)).getTime() > day.date.getTime();
                return (
                  <TouchableOpacity
                    key={block.event.id}
                    style={[
                      styles.eventBlock,
                      continuesBefore && styles.eventBlockContinuesBefore,
                      continuesAfter && styles.eventBlockContinuesAfter,
                      {
                        top: block.topHours * HOUR_HEIGHT,
                        height: Math.max(block.heightHours * HOUR_HEIGHT, 22),
                        left: `${block.leftPct}%`,
                        width: `${block.widthPct}%`,
                        borderLeftColor: attendees[0].color_hex,
                      },
                    ]}
                    onPress={() => onEditEvent(block.event)}
                  >
                    <AttendeeDots attendees={attendees} familySize={familySize} />
                    <Text style={styles.eventBlockTitle} numberOfLines={2}>{block.event.title}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4 },
    dayHeader: { flex: 1, alignItems: 'center', paddingVertical: 2 },
    today: { backgroundColor: colors.surfaceAlt },
    dayHeaderWeekday: { fontSize: 11, color: colors.textFaint, fontWeight: '600' },
    dayHeaderDate: { fontSize: 13, color: colors.text, fontWeight: '600' },
    todayText: { color: colors.primary },
    addBtn: { fontSize: 13, color: colors.placeholder, paddingHorizontal: 6 },
    allDayRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 20 },
    timeLabelSmall: { fontSize: 8, color: colors.textFaint, textAlign: 'center' },
    allDayCell: { flex: 1, padding: 1 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: colors.chip, borderRadius: 3,
      paddingHorizontal: 3, paddingVertical: 1, marginBottom: 1,
    },
    chipContinuesBefore: {
      borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
      marginLeft: -1, paddingLeft: 1,
    },
    chipContinuesAfter: {
      borderTopRightRadius: 0, borderBottomRightRadius: 0,
      marginRight: -1, paddingRight: 1,
    },
    chipText: { fontSize: 9.5, color: colors.chipText, flexShrink: 1 },
    body: { flex: 1 },
    bodyRow: { flexDirection: 'row' },
    hourRow: {
      height: HOUR_HEIGHT, borderTopWidth: 1, borderTopColor: colors.border,
    },
    hourLabel: { fontSize: 9, color: colors.textFaint, marginTop: -6, paddingRight: 3, textAlign: 'right' },
    dayCol: { flex: 1, position: 'relative', borderLeftWidth: 1, borderLeftColor: colors.border },
    eventBlock: {
      position: 'absolute', backgroundColor: colors.chip, borderLeftWidth: 3,
      borderRadius: 3, padding: 2, overflow: 'hidden',
    },
    eventBlockContinuesBefore: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
    eventBlockContinuesAfter: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
    eventBlockTitle: { fontSize: 9.5, color: colors.chipText },
  });
}
