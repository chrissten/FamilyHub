import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getEvents, getUsers, addDays, startOfWeek, rangeLabel, buildMultiDayView, isSameDay,
  useTheme, type Colors, type CalendarEvent, type User,
} from '../../src/shared';
import WeekBoard from '../../src/WeekBoard';
import EventDetails from '../../src/EventDetails';

const REFRESH_MS = 2 * 60 * 1000;
// After someone browses to another week, snap back to this week once it's been left alone.
const SNAP_BACK_MS = 3 * 60 * 1000;

export default function CalendarScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const lastNavRef = useRef(0);

  const weekDates = useMemo(() => {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [anchor]);

  const load = useCallback(async () => {
    try {
      // A day of slack either side catches events that spill over the week's edges.
      const [evts, users] = await Promise.all([
        getEvents({ start: addDays(weekDates[0], -1).toISOString(), end: addDays(weekDates[6], 2).toISOString() }),
        getUsers(),
      ]);
      setEvents(evts);
      setMembers(users);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [weekDates]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      const today = new Date();
      const showingThisWeek = isSameDay(startOfWeek(anchor), startOfWeek(today));
      if (!showingThisWeek && Date.now() - lastNavRef.current > SNAP_BACK_MS) setAnchor(today);
      else load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [anchor, load]);

  function navigate(next: Date) {
    lastNavRef.current = Date.now();
    setAnchor(next);
  }

  const days = useMemo(() => buildMultiDayView(events, weekDates), [events, weekDates]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.navGroup}>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigate(addDays(anchor, -7))}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.todayBtn} onPress={() => navigate(new Date())}>
            <Text style={styles.todayText}>This week</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigate(addDays(anchor, 7))}>
            <Ionicons name="chevron-forward" size={28} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.range}>{rangeLabel(weekDates[0], weekDates[6])}</Text>
          {error && <Ionicons name="cloud-offline-outline" size={24} color={colors.danger} />}
        </View>
        <View style={styles.legend}>
          {members.map(m => (
            <View key={m.id} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: m.color_hex }]} />
              <Text style={styles.legendText}>{m.display_name}</Text>
            </View>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />
      ) : (
        <WeekBoard days={days} onSelectEvent={setSelected} />
      )}

      <EventDetails event={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.surface,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    navGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    navBtn: { padding: 8, borderRadius: 12, backgroundColor: colors.surfaceAlt },
    todayBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceAlt },
    todayText: { fontSize: 16, fontWeight: '600', color: colors.text },
    range: { fontSize: 24, fontWeight: '700', color: colors.text, marginLeft: 12, marginRight: 8 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, flexShrink: 1, justifyContent: 'flex-end' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 14, height: 14, borderRadius: 7 },
    legendText: { fontSize: 15, color: colors.text, fontWeight: '500' },
  });
}
