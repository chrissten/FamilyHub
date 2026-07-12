import { useCallback, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getEvents, getUsers, createEvent, updateEvent, deleteEvent,
} from '../../src/api/client';
import type { CalendarEvent, User } from '../../src/api/types';
import {
  addDays, buildAgendaView, buildDayAgenda, buildMonthGrid, buildMultiDayView, dayLabel, isoDate,
  monthLabel, rangeLabel, startOfWeek,
} from '../../src/calendar/dateUtils';
import MonthView from '../../src/calendar/MonthView';
import TimelineView from '../../src/calendar/TimelineView';
import DayAgenda from '../../src/calendar/DayAgenda';
import AgendaView from '../../src/calendar/AgendaView';
import EventFormModal, { type EventFormValues } from '../../src/calendar/EventFormModal';

type ViewKind = 'month' | 'week' | '3day' | 'day' | 'agenda';
const VIEWS: { key: ViewKind; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: '3day', label: '3 Day' },
  { key: 'day', label: 'Day' },
  { key: 'agenda', label: 'Agenda' },
];

export default function CalendarScreen() {
  const [view, setView] = useState<ViewKind>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalEvent, setModalEvent] = useState<CalendarEvent | null>(null);
  const [modalDefaultDate, setModalDefaultDate] = useState('');

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setRefreshing(true);
    try {
      const [evts, users] = await Promise.all([getEvents(), getUsers()]);
      setEvents(evts);
      setMembers(users);
    } catch {
      Alert.alert('Error', 'Could not load calendar');
    } finally {
      setRefreshing(false);
    }
  }

  function openCreate(date: Date) {
    setModalEvent(null);
    setModalDefaultDate(isoDate(date));
    setModalVisible(true);
  }

  function openEdit(event: CalendarEvent) {
    setModalEvent(event);
    setModalDefaultDate('');
    setModalVisible(true);
  }

  async function handleSave(values: EventFormValues) {
    setSaving(true);
    try {
      if (modalEvent) {
        const updated = await updateEvent(modalEvent.id, values);
        setEvents(prev => prev.map(e => (e.id === updated.id ? updated : e)));
      } else {
        const created = await createEvent(values);
        setEvents(prev => [...prev, created]);
      }
      setModalVisible(false);
    } catch {
      Alert.alert('Error', 'Could not save event');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(event: CalendarEvent) {
    try {
      await deleteEvent(event.id);
      setEvents(prev => prev.filter(e => e.id !== event.id));
      setModalVisible(false);
    } catch {
      Alert.alert('Error', 'Could not delete event');
    }
  }

  function step(direction: -1 | 1) {
    setAnchor(prev => {
      if (view === 'month' || view === 'agenda') return new Date(prev.getFullYear(), prev.getMonth() + direction, 1);
      if (view === 'week') return addDays(prev, 7 * direction);
      if (view === '3day') return addDays(prev, 3 * direction);
      return addDays(prev, direction);
    });
  }

  function goToday() {
    setAnchor(new Date());
  }

  function selectDay(date: Date) {
    setAnchor(date);
    setView('day');
  }

  const familySize = members.length;
  let headerLabel = '';
  let body: ReactNode;

  if (view === 'month') {
    headerLabel = monthLabel(anchor.getFullYear(), anchor.getMonth());
    const grid = buildMonthGrid(events, anchor.getFullYear(), anchor.getMonth());
    body = (
      <MonthView
        grid={grid}
        familySize={familySize}
        refreshing={refreshing}
        onRefresh={load}
        onAddEvent={openCreate}
        onEditEvent={openEdit}
        onSelectDay={selectDay}
      />
    );
  } else if (view === 'week') {
    const weekStart = startOfWeek(anchor);
    const dayDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    headerLabel = rangeLabel(dayDates[0], dayDates[6]);
    const days = buildMultiDayView(events, dayDates);
    body = (
      <TimelineView
        days={days} familySize={familySize} refreshing={refreshing} onRefresh={load}
        onAddEvent={openCreate} onEditEvent={openEdit}
      />
    );
  } else if (view === '3day') {
    const dayDates = Array.from({ length: 3 }, (_, i) => addDays(anchor, i));
    headerLabel = rangeLabel(dayDates[0], dayDates[2]);
    const days = buildMultiDayView(events, dayDates);
    body = (
      <TimelineView
        days={days} familySize={familySize} refreshing={refreshing} onRefresh={load}
        onAddEvent={openCreate} onEditEvent={openEdit}
      />
    );
  } else if (view === 'day') {
    headerLabel = dayLabel(anchor);
    const agenda = buildDayAgenda(events, anchor);
    body = (
      <DayAgenda
        events={agenda}
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
    const days = buildAgendaView(events, anchor.getFullYear(), anchor.getMonth());
    body = (
      <AgendaView
        days={days}
        familySize={familySize}
        refreshing={refreshing}
        onRefresh={load}
        onAddEvent={openCreate}
        onEditEvent={openEdit}
        onDeleteEvent={handleDelete}
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

      <EventFormModal
        visible={modalVisible}
        event={modalEvent}
        defaultDate={modalDefaultDate}
        members={members}
        saving={saving}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  tabs: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#e8e8e8',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#4A90D9' },
  tabText: { color: '#999', fontSize: 13 },
  tabTextActive: { color: '#4A90D9', fontWeight: '600' },
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#e8e8e8',
  },
  navBtn: { color: '#4A90D9', fontSize: 14, fontWeight: '600' },
  navLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginHorizontal: 8 },
  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#4A90D9', justifyContent: 'center', alignItems: 'center',
    elevation: 5, shadowColor: '#4A90D9', shadowOpacity: 0.4, shadowRadius: 8,
  },
  fabText: { color: '#fff', fontSize: 30, lineHeight: 34 },
});
