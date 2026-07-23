import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, RefreshControl, type ViewToken,
} from 'react-native';
import type { CalendarEvent } from '../api/types';
import AttendeeDots from './AttendeeDots';
import { AgendaDay, MONTH_NAMES, WEEKDAY_NAMES, buildAgendaView, eventTimeLabel } from './dateUtils';
import { useTimeFormat } from '../preferences';
import { useTheme, type Colors } from '../theme';

interface Props {
  anchor: Date;
  /** Bumped by the parent every time Prev/Next/Today is pressed, so the same anchor
   *  month can be re-requested (e.g. jumping back to today within the month already
   *  on screen) without being swallowed by the scroll-driven anchor sync below. */
  navNonce: number;
  events: CalendarEvent[];
  familySize: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAddEvent: (date: Date) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
  /** Called as the user scrolls past a month boundary, so the parent's header label
   *  (and other views, if the user switches to one) stay in sync with what's on screen. */
  onVisibleMonthChange: (date: Date) => void;
}

interface MonthKey {
  year: number;
  month: number;
}

interface AgendaRow {
  key: string;
  day: AgendaDay;
  monthDivider: string | null;
}

function monthKeyStr(year: number, month: number): string {
  return `${year}-${month}`;
}

function addMonths(year: number, month: number, n: number): MonthKey {
  const d = new Date(year, month + n, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function buildRows(events: CalendarEvent[], months: MonthKey[]): AgendaRow[] {
  const rows: AgendaRow[] = [];
  for (const m of months) {
    const days = buildAgendaView(events, m.year, m.month);
    days.forEach((day, i) => {
      rows.push({
        key: day.date.toISOString(),
        day,
        monthDivider: i === 0 ? `${MONTH_NAMES[m.month]} ${m.year}` : null,
      });
    });
  }
  return rows;
}

/** Port of app/templates/_calendar_agenda.html — a scrolling list spanning every day,
 *  seamlessly loading adjacent months as the user scrolls past either edge. */
export default function AgendaView({
  anchor, navNonce, events, familySize, refreshing, onRefresh, onAddEvent, onEditEvent, onDeleteEvent,
  onVisibleMonthChange,
}: Props) {
  const timeFormat = useTimeFormat();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listRef = useRef<FlatList<AgendaRow>>(null);

  const [months, setMonths] = useState<MonthKey[]>(() => {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    return [addMonths(y, m, -1), { year: y, month: m }, addMonths(y, m, 1)];
  });
  const rows = useMemo(() => buildRows(events, months), [events, months]);

  const loadingPrevRef = useRef(false);
  const loadingNextRef = useRef(false);
  const lastVisibleMonthKeyRef = useRef(monthKeyStr(anchor.getFullYear(), anchor.getMonth()));
  const onVisibleMonthChangeRef = useRef(onVisibleMonthChange);
  onVisibleMonthChangeRef.current = onVisibleMonthChange;

  const pendingScrollRef = useRef<{ year: number; month: number; date: number } | null>(null);
  const lastNonceRef = useRef(navNonce);

  // Prev/Next/Today: always (re-)scroll to the requested date, extending the loaded
  // month range first if it isn't already there.
  useEffect(() => {
    if (navNonce === lastNonceRef.current) return;
    lastNonceRef.current = navNonce;

    const y = anchor.getFullYear(), m = anchor.getMonth(), d = anchor.getDate();
    pendingScrollRef.current = { year: y, month: m, date: d };
    setMonths(prev => {
      const first = prev[0], last = prev[prev.length - 1];
      const target = y * 12 + m;
      const firstIdx = first.year * 12 + first.month;
      const lastIdx = last.year * 12 + last.month;
      if (target >= firstIdx && target <= lastIdx) return prev;
      if (target < firstIdx) {
        const fill: MonthKey[] = [];
        for (let t = target; t < firstIdx; t++) fill.push({ year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 });
        return [...fill, ...prev];
      }
      const fill: MonthKey[] = [];
      for (let t = lastIdx + 1; t <= target; t++) fill.push({ year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 });
      return [...prev, ...fill];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navNonce]);

  // Scroll to today on first mount too.
  useEffect(() => {
    pendingScrollRef.current = { year: anchor.getFullYear(), month: anchor.getMonth(), date: anchor.getDate() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending) return;
    const index = rows.findIndex(r =>
      r.day.date.getFullYear() === pending.year && r.day.date.getMonth() === pending.month
      && r.day.date.getDate() === pending.date
    );
    if (index < 0) return;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
      } catch {
        // list not measured yet — onScrollToIndexFailed below will retry
      }
    });
  }, [rows]);

  function loadPreviousMonth() {
    if (loadingPrevRef.current) return;
    loadingPrevRef.current = true;
    setMonths(prev => [addMonths(prev[0].year, prev[0].month, -1), ...prev]);
    setTimeout(() => { loadingPrevRef.current = false; }, 600);
  }

  function loadNextMonth() {
    if (loadingNextRef.current) return;
    loadingNextRef.current = true;
    setMonths(prev => [...prev, addMonths(prev[prev.length - 1].year, prev[prev.length - 1].month, 1)]);
    setTimeout(() => { loadingNextRef.current = false; }, 600);
  }

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length === 0) return;
    const top = viewableItems[0].item as AgendaRow;
    const key = monthKeyStr(top.day.date.getFullYear(), top.day.date.getMonth());
    if (key === lastVisibleMonthKeyRef.current) return;
    lastVisibleMonthKeyRef.current = key;
    onVisibleMonthChangeRef.current(top.day.date);
  }).current;

  function confirmDelete(event: CalendarEvent) {
    Alert.alert('Delete Event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteEvent(event) },
    ]);
  }

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={item => item.key}
      contentContainerStyle={styles.list}
      initialNumToRender={45}
      onScroll={e => { if (e.nativeEvent.contentOffset.y < 400) loadPreviousMonth(); }}
      scrollEventThrottle={200}
      onEndReached={loadNextMonth}
      onEndReachedThreshold={1}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={{ itemVisiblePercentThreshold: 1 }}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onScrollToIndexFailed={info => {
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 });
        }, 100);
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item: row }) => {
        const day = row.day;
        return (
          <View style={styles.day}>
            {row.monthDivider && (
              <Text style={styles.monthDivider}>{row.monthDivider}</Text>
            )}
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
              <View style={styles.dayCard}>
                {day.events.map((item, i) => {
                  const attendees = item.attendees.length ? item.attendees : [item.owner];
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.eventRow, i === day.events.length - 1 && styles.eventRowLast]}
                      onPress={() => onEditEvent(item)}
                      onLongPress={() => confirmDelete(item)}
                      activeOpacity={0.6}
                    >
                      <View style={[styles.eventDot, { backgroundColor: attendees[0].color_hex }]} />
                      <Text style={styles.eventTime}>{eventTimeLabel(item, day.date, timeFormat)}</Text>
                      <Text style={styles.eventTitle} numberOfLines={1}>
                        {item.title}{item.series_id ? ' ↻' : ''}
                        {!!item.location && <Text style={styles.eventLocation}>  📍 {item.location}</Text>}
                      </Text>
                      <AttendeeDots attendees={attendees} familySize={familySize} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      }}
    />
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    list: { padding: 12, paddingBottom: 80 },
    monthDivider: {
      fontSize: 13, fontWeight: '700', color: colors.textMuted,
      marginTop: 4, marginBottom: 10,
    },
    day: { marginBottom: 10 },
    dayHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
    dayLabel: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    dayWeekday: { fontSize: 15, fontWeight: '700', color: colors.text },
    dayDate: { fontSize: 13, color: colors.textMuted },
    dayToday: { color: colors.primary },
    addLink: { color: colors.primary, fontWeight: '700', fontSize: 16, paddingHorizontal: 6 },
    empty: { color: colors.placeholder, fontSize: 13, fontStyle: 'italic' },
    dayCard: {
      backgroundColor: colors.surface, borderRadius: 10, overflow: 'hidden',
      shadowColor: colors.shadow, shadowOpacity: 0.06, shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 }, elevation: 2,
    },
    eventRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 10, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    eventRowLast: { borderBottomWidth: 0 },
    eventDot: { width: 7, height: 7, borderRadius: 3.5 },
    eventTime: { fontSize: 12, color: colors.primary, width: 68 },
    eventTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
    eventLocation: { fontSize: 12, fontWeight: '400', color: colors.textFaint },
  });
}
