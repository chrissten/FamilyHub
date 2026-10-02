import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, type LayoutChangeEvent } from 'react-native';
import {
  useTheme, useTimeFormat, dateOnly, eventStart, eventEnd, eventTimeLabel, hourLabel,
  HOURS, WEEKDAY_NAMES, type Colors, type CalendarEvent, type DayColumn,
} from './shared';

const TIME_COL_WIDTH = 64;
// The part of the day that fills the screen without scrolling; earlier and later hours
// are a scroll away.
const FIRST_VISIBLE_HOUR = 7;
const VISIBLE_HOURS = 14;
const MIN_HOUR_HEIGHT = 44;

interface Props {
  days: DayColumn[];
  onSelectEvent: (event: CalendarEvent) => void;
}

/** Wall-calendar week grid sized for a 15" landscape screen — the phone's TimelineView
 *  scaled up, colour-coded by the first attendee so kids can spot their own events. */
export default function WeekBoard({ days, onSelectEvent }: Props) {
  const { colors } = useTheme();
  const timeFormat = useTimeFormat();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [hourHeight, setHourHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const now = useNow();

  function onBodyLayout(e: LayoutChangeEvent) {
    const next = Math.max(MIN_HOUR_HEIGHT, Math.floor(e.nativeEvent.layout.height / VISIBLE_HOURS));
    if (next !== hourHeight) setHourHeight(next);
  }

  useEffect(() => {
    if (hourHeight) scrollRef.current?.scrollTo({ y: FIRST_VISIBLE_HOUR * hourHeight, animated: false });
  }, [hourHeight]);

  const hasAllDay = days.some(d => d.allDayEvents.length > 0);
  const nowHours = now.getHours() + now.getMinutes() / 60;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ width: TIME_COL_WIDTH }} />
        {days.map(day => (
          <View key={day.date.toISOString()} style={[styles.dayHeader, day.isToday && styles.todayHeader]}>
            <Text style={[styles.weekday, day.isToday && styles.todayText]}>{WEEKDAY_NAMES[day.date.getDay()]}</Text>
            <Text style={[styles.dateNum, day.isToday && styles.todayText]}>{day.date.getDate()}</Text>
          </View>
        ))}
      </View>

      {hasAllDay && (
        <View style={styles.allDayRow}>
          <View style={[styles.allDayLabel, { width: TIME_COL_WIDTH }]}>
            <Text style={styles.allDayLabelText}>All day</Text>
          </View>
          {days.map(day => (
            <View key={day.date.toISOString()} style={[styles.allDayCell, day.isToday && styles.todayCol]}>
              {day.allDayEvents.map(event => {
                const color = (event.attendees[0] ?? event.owner).color_hex;
                const continuesBefore = dateOnly(eventStart(event)).getTime() < day.date.getTime();
                return (
                  <TouchableOpacity
                    key={event.id}
                    style={[styles.chip, { backgroundColor: color + '33', borderLeftColor: color }]}
                    onPress={() => onSelectEvent(event)}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>
                      {continuesBefore ? '… ' : ''}{event.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      )}

      <View style={styles.body} onLayout={onBodyLayout}>
        {hourHeight > 0 && (
          <ScrollView ref={scrollRef}>
            <View style={styles.bodyRow}>
              <View style={{ width: TIME_COL_WIDTH }}>
                {HOURS.map(h => (
                  <View key={h} style={{ height: hourHeight }}>
                    <Text style={styles.hourLabel}>{h === 0 ? '' : hourLabel(h, timeFormat)}</Text>
                  </View>
                ))}
              </View>
              {days.map(day => (
                <View key={day.date.toISOString()} style={[styles.dayCol, day.isToday && styles.todayCol]}>
                  {HOURS.map(h => <View key={h} style={[styles.hourLine, { height: hourHeight }]} />)}
                  {day.blocks.map(block => {
                    const event = block.event;
                    const color = (event.attendees[0] ?? event.owner).color_hex;
                    const height = Math.max(block.heightHours * hourHeight, 30);
                    const continuesBefore = dateOnly(eventStart(event)).getTime() < day.date.getTime();
                    const continuesAfter = dateOnly(eventEnd(event)).getTime() > day.date.getTime();
                    return (
                      <TouchableOpacity
                        key={event.id}
                        style={[
                          styles.block,
                          {
                            top: block.topHours * hourHeight,
                            height,
                            left: `${block.leftPct}%`,
                            width: `${block.widthPct}%`,
                            backgroundColor: color + '33',
                            borderLeftColor: color,
                          },
                          continuesBefore && { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
                          continuesAfter && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
                        ]}
                        onPress={() => onSelectEvent(event)}
                      >
                        <Text style={styles.blockTitle} numberOfLines={height > 50 ? 2 : 1}>{event.title}</Text>
                        {height > 50 && (
                          <Text style={styles.blockTime} numberOfLines={1}>
                            {eventTimeLabel(event, day.date, timeFormat)}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  {day.isToday && (
                    <View pointerEvents="none" style={[styles.nowLine, { top: nowHours * hourHeight }]}>
                      <View style={styles.nowDot} />
                    </View>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/** Current time, ticking once a minute (drives the red "now" line). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
    dayHeader: { flex: 1, alignItems: 'center', paddingVertical: 8 },
    todayHeader: { backgroundColor: colors.primary + '1A' },
    weekday: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
    dateNum: { fontSize: 28, fontWeight: '700', color: colors.text },
    todayText: { color: colors.primary },
    allDayRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
    allDayLabel: { justifyContent: 'center', alignItems: 'flex-end', paddingRight: 8 },
    allDayLabelText: { fontSize: 12, color: colors.textFaint },
    allDayCell: { flex: 1, padding: 3, gap: 3, borderLeftWidth: 1, borderLeftColor: colors.border },
    chip: { borderLeftWidth: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
    chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
    body: { flex: 1 },
    bodyRow: { flexDirection: 'row' },
    hourLabel: { fontSize: 13, color: colors.textFaint, textAlign: 'right', paddingRight: 8, marginTop: -8 },
    dayCol: { flex: 1, borderLeftWidth: 1, borderLeftColor: colors.border },
    todayCol: { backgroundColor: colors.primary + '0D' },
    hourLine: { borderTopWidth: 1, borderTopColor: colors.border },
    block: {
      position: 'absolute', borderLeftWidth: 5, borderRadius: 8,
      paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden',
    },
    blockTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    blockTime: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
    nowLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: colors.danger },
    nowDot: {
      position: 'absolute', left: -5, top: -4, width: 10, height: 10, borderRadius: 5,
      backgroundColor: colors.danger,
    },
  });
}
