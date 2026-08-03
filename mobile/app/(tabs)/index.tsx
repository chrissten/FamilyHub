import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getEvents, getUsers, deleteEvent,
} from '../../src/api/client';
import type { CalendarEvent, User } from '../../src/api/types';
import {
  addDays, buildDayAgenda, buildMonthGrid, buildMultiDayView, dayLabel, isoDate,
  monthLabel, rangeLabel, startOfWeek,
} from '../../src/calendar/dateUtils';
import MonthView from '../../src/calendar/MonthView';
import TimelineView from '../../src/calendar/TimelineView';
import DayAgenda from '../../src/calendar/DayAgenda';
import AgendaView from '../../src/calendar/AgendaView';
import { setPendingEventForm } from '../../src/calendar/formState';
import { useTheme, type Colors } from '../../src/theme';
import { loadLastCalendarView, setLastCalendarView } from '../../src/preferences';

type ViewKind = 'month' | 'week' | '3day' | 'day' | 'agenda';
const VIEWS: { key: ViewKind; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: '3day', label: '3 Day' },
  { key: 'day', label: 'Day' },
  { key: 'agenda', label: 'Agenda' },
];

// How far around the viewed date to fetch at once. Wide enough that normal
// Prev/Next/Today navigation and Agenda's scroll-driven month loading never fall
// outside it, but still bounded so the request doesn't grow with the lifetime of the
// calendar (recurring series only materialize ~24 months out — see app/recurrence.py).
const RANGE_PAST_MONTHS = 12;
const RANGE_FUTURE_MONTHS = 15;

function windowFor(center: Date): { start: Date; end: Date } {
  const start = addDays(new Date(center.getFullYear(), center.getMonth() - RANGE_PAST_MONTHS, 1), -1);
  const end = addDays(new Date(center.getFullYear(), center.getMonth() + RANGE_FUTURE_MONTHS + 1, 0), 1);
  return { start, end };
}

export default function CalendarScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [view, setViewState] = useState<ViewKind>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [navNonce, setNavNonce] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Read inside load()/effects so a stale closure (e.g. the useFocusEffect callback,
  // memoized once on mount) still sees the current anchor and fetched range.
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const loadedRangeRef = useRef<{ start: Date; end: Date } | null>(null);

  function setView(next: ViewKind) {
    setViewState(next);
    setLastCalendarView(next);
  }

  useEffect(() => { loadLastCalendarView().then(setViewState); }, []);

  useFocusEffect(useCallback(() => { load(); }, []));

  // Whenever navigation (Prev/Next/Today, jumping into Day view, or Agenda's
  // scroll-driven onVisibleMonthChange) moves the anchor outside the currently fetched
  // range, pull in a new range centered on it.
  useEffect(() => {
    const loaded = loadedRangeRef.current;
    if (!loaded) return;
    if (anchor.getTime() < loaded.start.getTime() || anchor.getTime() > loaded.end.getTime()) {
      load(anchor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  async function load(center: Date = anchorRef.current) {
    setRefreshing(true);
    try {
      const loaded = loadedRangeRef.current;
      const needsNewRange = !loaded
        || center.getTime() < loaded.start.getTime() || center.getTime() > loaded.end.getTime();
      const range = needsNewRange ? windowFor(center) : loaded;
      const [evts, users] = await Promise.all([
        getEvents({ start: range.start.toISOString(), end: range.end.toISOString() }),
        getUsers(),
      ]);
      loadedRangeRef.current = range;
      setEvents(evts);
      setMembers(users);
    } catch {
      Alert.alert('Error', 'Could not load calendar');
    } finally {
      setRefreshing(false);
    }
  }

  function openCreate(date: Date) {
    setPendingEventForm({ event: null, defaultDate: isoDate(date), members });
    router.push('/event-form');
  }

  function openEdit(event: CalendarEvent) {
    setPendingEventForm({ event, defaultDate: '', members });
    router.push('/event-form');
  }

  async function handleDelete(event: CalendarEvent) {
    try {
      await deleteEvent(event.id);
      setEvents(prev => prev.filter(e => e.id !== event.id));
    } catch {
      Alert.alert('Error', 'Could not delete event');
    }
  }

  function step(direction: -1 | 1) {
    setNavNonce(n => n + 1);
    setAnchor(prev => {
      if (view === 'month' || view === 'agenda') return new Date(prev.getFullYear(), prev.getMonth() + direction, 1);
      if (view === 'week') return addDays(prev, 7 * direction);
      if (view === '3day') return addDays(prev, 3 * direction);
      return addDays(prev, direction);
    });
  }

  function goToday() {
    setNavNonce(n => n + 1);
    setAnchor(new Date());
  }

  function selectDay(date: Date) {
    setAnchor(date);
    setView('day');
  }

  const familySize = members.length;

  // Memoized so a plain view-tab switch (no change to events/anchor) is a cheap
  // re-render instead of re-walking the whole event list and re-doing per-event
  // timezone conversion (see dateUtils.ts's zonedParts) on every switch.
  const monthGrid = useMemo(
    () => buildMonthGrid(events, anchor.getFullYear(), anchor.getMonth()),
    [events, anchor],
  );
  const weekDayDates = useMemo(() => {
    const weekStart = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [anchor]);
  const weekDays = useMemo(() => buildMultiDayView(events, weekDayDates), [events, weekDayDates]);
  const threeDayDates = useMemo(
    () => Array.from({ length: 3 }, (_, i) => addDays(anchor, i)),
    [anchor],
  );
  const threeDays = useMemo(() => buildMultiDayView(events, threeDayDates), [events, threeDayDates]);
  const dayAgenda = useMemo(() => buildDayAgenda(events, anchor), [events, anchor]);

  let headerLabel = '';
  let body: ReactNode;

  if (view === 'month') {
    headerLabel = monthLabel(anchor.getFullYear(), anchor.getMonth());
    body = (
      <MonthView
        grid={monthGrid}
        familySize={familySize}
        refreshing={refreshing}
        onRefresh={load}
        onAddEvent={openCreate}
        onEditEvent={openEdit}
        onSelectDay={selectDay}
      />
    );
  } else if (view === 'week') {
    headerLabel = rangeLabel(weekDayDates[0], weekDayDates[6]);
    body = (
      <TimelineView
        days={weekDays} familySize={familySize} refreshing={refreshing} onRefresh={load}
        onAddEvent={openCreate} onEditEvent={openEdit}
      />
    );
  } else if (view === '3day') {
    headerLabel = rangeLabel(threeDayDates[0], threeDayDates[2]);
    body = (
      <TimelineView
        days={threeDays} familySize={familySize} refreshing={refreshing} onRefresh={load}
        onAddEvent={openCreate} onEditEvent={openEdit}
      />
    );
  } else if (view === 'day') {
    headerLabel = dayLabel(anchor);
    body = (
      <DayAgenda
        events={dayAgenda}
        theDate={anchor}
        familySize={familySize}
        refreshing={refreshing}
        onRefresh={load}
        onAddEvent={() => openCreate(anchor)}
        onEditEvent={openEdit}
        onDeleteEvent={handleDelete}
      />
    );
  } else {
    headerLabel = monthLabel(anchor.getFullYear(), anchor.getMonth());
    body = (
      <AgendaView
        anchor={anchor}
        navNonce={navNonce}
        events={events}
        familySize={familySize}
        refreshing={refreshing}
        onRefresh={load}
        onAddEvent={openCreate}
        onEditEvent={openEdit}
        onDeleteEvent={handleDelete}
        onVisibleMonthChange={setAnchor}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {VIEWS.map(v => (
          <TouchableOpacity
            key={v.key}
            style={[styles.tab, view === v.key && styles.tabActive]}
            onPress={() => setView(v.key)}
          >
            <Text style={[styles.tabText, view === v.key && styles.tabTextActive]}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => step(-1)} hitSlop={8}>
          <Text style={styles.navBtn}>‹ Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goToday} hitSlop={8}>
          <Text style={styles.navLabel} numberOfLines={1}>{headerLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => step(1)} hitSlop={8}>
          <Text style={styles.navBtn}>Next ›</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>{body}</View>

      <TouchableOpacity style={styles.fab} onPress={() => openCreate(anchor)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    tabs: {
      flexDirection: 'row', backgroundColor: colors.surface,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
    tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    tabText: { color: colors.textFaint, fontSize: 13 },
    tabTextActive: { color: colors.primary, fontWeight: '600' },
    navRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    navBtn: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    navLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.text, marginHorizontal: 8 },
    fab: {
      position: 'absolute', right: 20, bottom: 20,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
      elevation: 5, shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 8,
    },
    fabText: { color: '#fff', fontSize: 30, lineHeight: 34 },
  });
}
