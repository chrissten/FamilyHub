import { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Switch, ScrollView, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { createEvent, updateEvent, deleteEvent, type EventScope, type RecurrenceOption } from '../src/api/client';
import { dayLabel, formatClock, isoDate, parseEventDate } from '../src/calendar/dateUtils';
import { monthlyLabel, weekdayLabel } from '../src/calendar/recurrence';
import { useTimeFormat, type TimeFormat } from '../src/preferences';
import { takePendingEventForm } from '../src/calendar/formState';
import { useTheme, type Colors } from '../src/theme';

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Builds a Date from a "YYYY-MM-DD" day and "HH:MM" 24h time, both interpreted in the device's local timezone. */
function localDateTime(dateStr: string, timeStr: string, seconds = 0, ms = 0): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, seconds, ms);
}

function timeOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTimeStr(timeStr: string, format: TimeFormat): string {
  const [hh, mm] = timeStr.split(':').map(Number);
  return formatClock(hh, mm, format);
}

/** Modal screen (expo-router `presentation: 'modal'`) mirroring app/templates/_event_form.html.
 *  A real screen rather than RN's <Modal> — Android Dialogs don't reliably resize for the
 *  keyboard even with KeyboardAvoidingView, but a normal screen honors the Activity's
 *  android:windowSoftInputMode="adjustResize" (see AndroidManifest.xml). */
export default function EventFormScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [payload] = useState(() => takePendingEventForm());
  const event = payload?.event ?? null;
  const members = payload?.members ?? [];
  const initialDate = payload?.defaultDate || isoDate(new Date());

  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [date, setDate] = useState(() => (event ? isoDate(parseEventDate(event.start_time)) : initialDate));
  const [endDate, setEndDate] = useState(() => (event ? isoDate(parseEventDate(event.end_time)) : initialDate));
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [startTime, setStartTime] = useState(() => (event ? timeOf(parseEventDate(event.start_time)) : '09:00'));
  const [endTime, setEndTime] = useState(() => (event ? timeOf(parseEventDate(event.end_time)) : '10:00'));
  const [attendeeIds, setAttendeeIds] = useState<Set<number>>(new Set(event?.attendees.map(a => a.id) ?? []));
  const [repeat, setRepeat] = useState<RecurrenceOption>('none');
  const [repeatUntilMode, setRepeatUntilMode] = useState<'never' | 'on'>(event?.series_until ? 'on' : 'never');
  const [repeatUntil, setRepeatUntil] = useState(event?.series_until ?? '');
  const [duplicating, setDuplicating] = useState(false);
  const [datePickerField, setDatePickerField] = useState<'start' | 'end' | 'until' | null>(null);
  const [timePickerField, setTimePickerField] = useState<'start' | 'end' | null>(null);
  const [saving, setSaving] = useState(false);
  const timeFormat = useTimeFormat();
  const isNew = !event || duplicating;

  function handleDateChange(pickerEvent: { type: string }, selected?: Date) {
    const field = datePickerField;
    setDatePickerField(null);
    if (pickerEvent.type === 'dismissed' || !selected || !field) return;
    const iso = isoDate(selected);
    if (field === 'start') setDate(iso);
    else if (field === 'end') setEndDate(iso);
    else setRepeatUntil(iso);
  }

  function handleDuplicate() {
    setDuplicating(true);
    setRepeat('none');
    setRepeatUntilMode('never');
    setRepeatUntil('');
  }

  function handleTimeChange(pickerEvent: { type: string }, selected?: Date) {
    const field = timePickerField;
    setTimePickerField(null);
    if (pickerEvent.type === 'dismissed' || !selected || !field) return;
    const time = timeOf(selected);
    if (field === 'start') setStartTime(time); else setEndTime(time);
  }

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

  async function save(action: () => Promise<unknown>) {
    setSaving(true);
    try {
      await action();
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save event');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!title.trim() || !date.trim()) {
      Alert.alert('Required', 'Title and date are required');
      return;
    }
    const lastDay = endDate && endDate >= date ? endDate : date;
    const start = allDay ? `${date}T00:00:00Z` : `${date}T${startTime}:00Z`;
    let end = allDay ? `${lastDay}T23:59:00Z` : `${lastDay}T${endTime}:00Z`;
    if (end < start) end = start;
    const values = {
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start_time: start,
      end_time: end,
      all_day: allDay,
      attendee_ids: Array.from(attendeeIds),
    };
    const recurrenceUntil = repeatUntilMode === 'on' && repeatUntil ? repeatUntil : null;

    if (!event || duplicating) {
      await save(() => createEvent({ ...values, recurrence: repeat, recurrence_until: recurrenceUntil }));
      return;
    }
    if (event.series_id) {
      Alert.alert('Save Event', 'Apply this change to just this event, or the whole series?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'This Event', onPress: () => save(() => updateEvent(event.id, values, 'this')) },
        {
          text: 'Whole Series',
          onPress: () => save(() => updateEvent(event.id, { ...values, recurrence_until: recurrenceUntil }, 'series')),
        },
      ]);
      return;
    }
    await save(() => updateEvent(event.id, values));
  }

  async function removeEvent(scope: EventScope) {
    if (!event) return;
    try {
      await deleteEvent(event.id, scope);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not delete event');
    }
  }

  function handleDelete() {
    if (!event) return;
    if (event.series_id) {
      Alert.alert('Delete Event', `Delete "${event.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'This Event', style: 'destructive', onPress: () => removeEvent('this') },
        { text: 'Whole Series', style: 'destructive', onPress: () => removeEvent('series') },
      ]);
      return;
    }
    Alert.alert('Delete Event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeEvent('this') },
    ]);
  }

  function endsPicker() {
    return (
      <View style={styles.repeatSection}>
        <Text style={styles.rowLabel}>Ends</Text>
        <View style={styles.repeatOptions}>
          {(['never', 'on'] as const).map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.repeatPill, repeatUntilMode === opt && styles.repeatPillActive]}
              onPress={() => setRepeatUntilMode(opt)}
            >
              <Text style={[styles.repeatPillText, repeatUntilMode === opt && styles.repeatPillTextActive]}>
                {opt === 'never' ? 'Never' : 'On date'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {repeatUntilMode === 'on' && (
          <TouchableOpacity style={styles.input} onPress={() => setDatePickerField('until')}>
            <Text style={repeatUntil ? styles.dateValue : styles.datePlaceholder}>
              {repeatUntil ? dayLabel(parseIsoDate(repeatUntil)) : 'End date'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
      <KeyboardAvoidingView
        style={styles.modal}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{isNew ? 'New Event' : 'Edit Event'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={[styles.modalSave, saving && { opacity: 0.4 }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.input} placeholder="Title *" value={title} onChangeText={setTitle}
            placeholderTextColor={colors.placeholder}
          />
          <TouchableOpacity style={styles.input} onPress={() => setDatePickerField('start')}>
            <Text style={date ? styles.dateValue : styles.datePlaceholder}>
              {date ? dayLabel(parseIsoDate(date)) : 'Start date *'}
            </Text>
          </TouchableOpacity>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>All day</Text>
            <Switch value={allDay} onValueChange={setAllDay} trackColor={{ false: colors.border, true: colors.primary }} />
          </View>
          {!allDay && (
            <TouchableOpacity style={[styles.input, styles.timeInput]} onPress={() => setTimePickerField('start')}>
              <Text style={styles.dateValue}>{formatTimeStr(startTime, timeFormat)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.input} onPress={() => setDatePickerField('end')}>
            <Text style={endDate ? styles.dateValue : styles.datePlaceholder}>
              {endDate ? dayLabel(parseIsoDate(endDate)) : 'End date'}
            </Text>
          </TouchableOpacity>
          {datePickerField && (
            <DateTimePicker
              value={parseIsoDate((
                datePickerField === 'start' ? date : datePickerField === 'end' ? endDate : repeatUntil
              ) || initialDate)}
              mode="date"
              display="calendar"
              onChange={handleDateChange}
            />
          )}
          {!allDay && (
            <TouchableOpacity style={[styles.input, styles.timeInput]} onPress={() => setTimePickerField('end')}>
              <Text style={styles.dateValue}>{formatTimeStr(endTime, timeFormat)}</Text>
            </TouchableOpacity>
          )}
          {timePickerField && (
            <DateTimePicker
              value={localDateTime(date, timePickerField === 'start' ? startTime : endTime)}
              mode="time"
              is24Hour={timeFormat === '24h'}
              display="default"
              onChange={handleTimeChange}
            />
          )}
          {isNew && (
            <View style={styles.repeatSection}>
              <Text style={styles.rowLabel}>Repeat</Text>
              <View style={styles.repeatOptions}>
                {([
                  ['none', 'Does not repeat'],
                  ['weekly', `Weekly on ${weekdayLabel(parseIsoDate(date))}`],
                  ['monthly', `Monthly on the ${monthlyLabel(parseIsoDate(date))}`],
                ] as [RecurrenceOption, string][]).map(([opt, label]) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.repeatPill, repeat === opt && styles.repeatPillActive]}
                    onPress={() => setRepeat(opt)}
                  >
                    <Text style={[styles.repeatPillText, repeat === opt && styles.repeatPillTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {repeat !== 'none' && endsPicker()}
            </View>
          )}
          {!isNew && !!event?.series_id && (
            <View style={styles.repeatSection}>
              <Text style={styles.hint}>🔁 Part of a repeating series</Text>
              {endsPicker()}
              <Text style={styles.hint}>Applies when you choose "Whole Series" on save</Text>
            </View>
          )}

          <TextInput
            style={styles.input} placeholder="Location" value={location} onChangeText={setLocation}
            placeholderTextColor={colors.placeholder}
          />
          <TextInput style={[styles.input, styles.textarea]} placeholder="Description"
            value={description} onChangeText={setDescription} multiline numberOfLines={3} textAlignVertical="top"
            placeholderTextColor={colors.placeholder}
          />

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
          {isNew && attendeeIds.size === 0 && (
            <Text style={styles.hint}>No selection defaults to just you</Text>
          )}

          {event && !duplicating && (
            <TouchableOpacity style={styles.duplicateBtn} onPress={handleDuplicate}>
              <Text style={styles.duplicateBtnText}>Duplicate Event</Text>
            </TouchableOpacity>
          )}
          {event && !duplicating && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Text style={styles.deleteBtnText}>Delete Event</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    modal: { flex: 1, padding: 20, backgroundColor: colors.surface },
    modalHeader: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', paddingTop: 8, marginBottom: 24,
    },
    modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
    modalCancel: { fontSize: 16, color: colors.textFaint },
    modalSave: { fontSize: 16, color: colors.primary, fontWeight: '700' },
    input: {
      backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 14,
      marginBottom: 12, fontSize: 16, color: colors.text,
    },
    textarea: { height: 88 },
    dateValue: { fontSize: 16, color: colors.text },
    datePlaceholder: { fontSize: 16, color: colors.textFaint },
    timeRow: { flexDirection: 'row', gap: 10 },
    timeInput: { flex: 1 },
    row: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', marginBottom: 12, paddingHorizontal: 2,
    },
    rowLabel: { fontSize: 16, color: colors.textMuted },
    repeatSection: { marginBottom: 12 },
    repeatOptions: { marginTop: 8, gap: 8 },
    repeatPill: {
      borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14,
      backgroundColor: colors.surfaceAlt,
    },
    repeatPillActive: { backgroundColor: colors.primary },
    repeatPillText: { fontSize: 15, color: colors.text },
    repeatPillTextActive: { color: colors.primaryText, fontWeight: '600' },
    attendeesHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 4, marginBottom: 8,
    },
    linkButton: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    attendeeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    checkbox: {
      width: 22, height: 22, borderRadius: 4,
      borderWidth: 2, borderColor: colors.border,
      justifyContent: 'center', alignItems: 'center', marginRight: 10,
    },
    checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
    swatch: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
    attendeeName: { fontSize: 15, color: colors.text },
    hint: { fontSize: 12, color: colors.placeholder, marginTop: 4, marginBottom: 8 },
    duplicateBtn: {
      marginTop: 20, paddingVertical: 14,
      alignItems: 'center', borderRadius: 10, backgroundColor: colors.surfaceAlt,
    },
    duplicateBtnText: { color: colors.text, fontWeight: '700', fontSize: 15 },
    deleteBtn: {
      marginTop: 12, marginBottom: 20, paddingVertical: 14,
      alignItems: 'center', borderRadius: 10, backgroundColor: colors.dangerBg,
    },
    deleteBtnText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  });
}
