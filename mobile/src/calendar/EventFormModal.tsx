import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Switch, Modal, ScrollView, Alert,
} from 'react-native';
import type { CalendarEvent, User } from '../api/types';
import { isoDate } from './dateUtils';

export interface EventFormValues {
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  attendee_ids: number[];
}

interface Props {
  visible: boolean;
  event: CalendarEvent | null;
  defaultDate: string;
  members: User[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: EventFormValues) => void;
  onDelete: (event: CalendarEvent) => void;
}

function timeOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Create/edit modal mirroring app/templates/_event_form.html. */
export default function EventFormModal({
  visible, event, defaultDate, members, saving, onClose, onSave, onDelete,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [attendeeIds, setAttendeeIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!visible) return;
    if (event) {
      const start = new Date(event.start_time);
      const end = new Date(event.end_time);
      setTitle(event.title);
      setDescription(event.description ?? '');
      setLocation(event.location ?? '');
      setDate(isoDate(start));
      setEndDate(isoDate(end));
      setAllDay(event.all_day);
      setStartTime(timeOf(start));
      setEndTime(timeOf(end));
      setAttendeeIds(new Set(event.attendees.map(a => a.id)));
    } else {
      setTitle('');
      setDescription('');
      setLocation('');
      setDate(defaultDate);
      setEndDate(defaultDate);
      setAllDay(false);
      setStartTime('09:00');
      setEndTime('10:00');
      setAttendeeIds(new Set());
    }
  }, [visible, event, defaultDate]);

  function toggleAttendee(id: number) {
    setAttendeeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setAttendeeIds(new Set(members.map(m => m.id)));
  }

  function handleSave() {
    if (!title.trim() || !date.trim()) {
      Alert.alert('Required', 'Title and date are required');
      return;
    }
    const lastDay = allDay && endDate && endDate >= date ? endDate : date;
    const start = allDay ? `${date}T00:00:00Z` : `${date}T${startTime}:00Z`;
    const end = allDay ? `${lastDay}T23:59:00Z` : `${date}T${endTime}:00Z`;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start_time: start,
      end_time: end,
      all_day: allDay,
      attendee_ids: Array.from(attendeeIds),
    });
  }

  function handleDelete() {
    if (!event) return;
    Alert.alert('Delete Event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(event) },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{event ? 'Edit Event' : 'New Event'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={[styles.modalSave, saving && { opacity: 0.4 }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput style={styles.input} placeholder="Title *" value={title} onChangeText={setTitle} />
          <TextInput style={styles.input} placeholder="Start date: YYYY-MM-DD *" value={date}
            onChangeText={setDate} keyboardType="numbers-and-punctuation" />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>All day</Text>
            <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: '#4A90D9' }} />
          </View>
          {allDay && (
            <TextInput style={styles.input} placeholder="End date: YYYY-MM-DD" value={endDate}
              onChangeText={setEndDate} keyboardType="numbers-and-punctuation" />
          )}
          {!allDay && (
            <View style={styles.timeRow}>
              <TextInput style={[styles.input, styles.timeInput]} placeholder="Start HH:MM"
                value={startTime} onChangeText={setStartTime} keyboardType="numbers-and-punctuation" />
              <TextInput style={[styles.input, styles.timeInput]} placeholder="End HH:MM"
                value={endTime} onChangeText={setEndTime} keyboardType="numbers-and-punctuation" />
            </View>
          )}
          <TextInput style={styles.input} placeholder="Location" value={location} onChangeText={setLocation} />
          <TextInput style={[styles.input, styles.textarea]} placeholder="Description"
            value={description} onChangeText={setDescription} multiline numberOfLines={3} textAlignVertical="top" />

          <View style={styles.attendeesHeader}>
            <Text style={styles.rowLabel}>Attendees</Text>
            <TouchableOpacity onPress={selectAll}>
              <Text style={styles.linkButton}>All</Text>
            </TouchableOpacity>
          </View>
          {members.map(member => {
            const checked = attendeeIds.has(member.id);
            return (
              <TouchableOpacity key={member.id} style={styles.attendeeRow} onPress={() => toggleAttendee(member.id)}>
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <View style={[styles.swatch, { backgroundColor: member.color_hex }]} />
                <Text style={styles.attendeeName}>{member.display_name}</Text>
              </TouchableOpacity>
            );
          })}
          {!event && attendeeIds.size === 0 && (
            <Text style={styles.hint}>No selection defaults to just you</Text>
          )}

          {event && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Text style={styles.deleteBtnText}>Delete Event</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, padding: 20, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingTop: 8, marginBottom: 24,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  modalCancel: { fontSize: 16, color: '#999' },
  modalSave: { fontSize: 16, color: '#4A90D9', fontWeight: '700' },
  input: {
    backgroundColor: '#f5f5f5', borderRadius: 10, padding: 14,
    marginBottom: 12, fontSize: 16, color: '#1a1a1a',
  },
  textarea: { height: 88 },
  timeRow: { flexDirection: 'row', gap: 10 },
  timeInput: { flex: 1 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12, paddingHorizontal: 2,
  },
  rowLabel: { fontSize: 16, color: '#333' },
  attendeesHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 4, marginBottom: 8,
  },
  linkButton: { color: '#4A90D9', fontSize: 14, fontWeight: '600' },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: {
    width: 22, height: 22, borderRadius: 4,
    borderWidth: 2, borderColor: '#ccc',
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  checkboxChecked: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  swatch: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  attendeeName: { fontSize: 15, color: '#1a1a1a' },
  hint: { fontSize: 12, color: '#bbb', marginTop: 4, marginBottom: 8 },
  deleteBtn: {
    marginTop: 20, marginBottom: 20, paddingVertical: 14,
    alignItems: 'center', borderRadius: 10, backgroundColor: '#fdecec',
  },
  deleteBtnText: { color: '#d64545', fontWeight: '700', fontSize: 15 },
});
