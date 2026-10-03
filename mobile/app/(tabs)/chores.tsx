import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, SectionList, StyleSheet, TouchableOpacity, RefreshControl, Alert, TextInput, Modal,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getChores, getChoreCompletions, getUsers, toggleChore, createChore, updateChore, deleteChore,
} from '../../src/api/client';
import type { Chore, User } from '../../src/api/types';
import { addDays, isoDate, startOfWeek, isSameDay, WEEKDAY_SHORT, rangeLabel } from '../../src/calendar/dateUtils';
import { useTheme, type Colors } from '../../src/theme';
import { useKeyboardHeight } from '../../src/useKeyboardHeight';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface Draft {
  id: number | null;
  name: string;
  assigneeId: number | null;
  days: number[];
}

export default function ChoresScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const keyboardHeight = useKeyboardHeight();
  const [selected, setSelected] = useState(() => new Date());
  const [chores, setChores] = useState<Chore[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  // chore ids completed on the selected day
  const [done, setDone] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const today = new Date();
  const weekDates = useMemo(() => {
    const start = startOfWeek(selected);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selected]);
  const isFuture = isoDate(selected) > isoDate(today);

  const load = useCallback(async (day: Date = selected) => {
    setRefreshing(true);
    try {
      const iso = isoDate(day);
      const [cs, users, completions] = await Promise.all([
        getChores(), getUsers(), getChoreCompletions(iso, iso),
      ]);
      setChores(cs);
      setMembers(users);
      setDone(new Set(completions.map(c => c.chore_id)));
    } catch {
      Alert.alert('Error', 'Could not load chores');
    } finally {
      setRefreshing(false);
    }
  }, [selected]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function selectDay(day: Date) {
    setSelected(day);
    load(day);
  }

  async function handleToggle(chore: Chore) {
    if (isFuture) return;
    const iso = isoDate(selected);
    const wasDone = done.has(chore.id);
    const flip = (on: boolean) => setDone(prev => {
      const next = new Set(prev);
      if (on) next.add(chore.id); else next.delete(chore.id);
      return next;
    });
    flip(!wasDone);
    try {
      flip((await toggleChore(chore.id, iso)).done);
    } catch {
      flip(wasDone);
      Alert.alert('Error', 'Could not update chore');
    }
  }

  async function handleSave() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return;
    if (draft.days.length === 0) {
      Alert.alert('Pick a day', 'Choose at least one day for this chore.');
      return;
    }
    try {
      if (draft.id === null) await createChore(name, draft.assigneeId, draft.days);
      else await updateChore(draft.id, name, draft.assigneeId, draft.days);
      setDraft(null);
      load();
    } catch {
      Alert.alert('Error', 'Could not save chore');
    }
  }

  function handleDelete() {
    if (!draft || draft.id === null) return;
    const id = draft.id;
    Alert.alert('Delete', `Delete "${draft.name}" and its history?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteChore(id);
            setDraft(null);
            load();
          } catch {
            Alert.alert('Error', 'Could not delete chore');
          }
        },
      },
    ]);
  }

  const sections = useMemo(() => {
    const due = chores.filter(c => c.days.includes(selected.getDay()));
    const groups = members
      .map(m => ({ title: m.display_name, color: m.color_hex, data: due.filter(c => c.assignee_id === m.id) }))
      .filter(g => g.data.length > 0);
    const anyone = due.filter(c => c.assignee_id === null);
    if (anyone.length > 0) groups.push({ title: 'Anyone', color: colors.textFaint, data: anyone });
    return groups;
  }, [chores, members, selected, colors]);

  function toggleDraftDay(n: number) {
    setDraft(d => d && ({ ...d, days: d.days.includes(n) ? d.days.filter(x => x !== n) : [...d.days, n].sort() }));
  }

  return (
    <View style={styles.container}>
      <View style={styles.weekBar}>
        <TouchableOpacity onPress={() => selectDay(addDays(selected, -7))} hitSlop={10}>
          <Text style={styles.weekArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.weekLabel}>{rangeLabel(weekDates[0], weekDates[6])}</Text>
        <TouchableOpacity onPress={() => selectDay(addDays(selected, 7))} hitSlop={10}>
          <Text style={styles.weekArrow}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.dayStrip}>
        {weekDates.map(d => {
          const active = isSameDay(d, selected);
          return (
            <TouchableOpacity key={d.getTime()} style={[styles.day, active && styles.dayActive]} onPress={() => selectDay(d)}>
              <Text style={[styles.dayName, active && styles.dayTextActive]}>{WEEKDAY_SHORT[d.getDay()]}</Text>
              <Text style={[styles.dayNum, active && styles.dayTextActive, isSameDay(d, today) && !active && styles.dayToday]}>
                {d.getDate()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={c => String(c.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        contentContainerStyle={{ paddingBottom: 90 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View style={[styles.dot, { backgroundColor: section.color }]} />
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>
              {section.data.filter(c => done.has(c.id)).length}/{section.data.length}
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const isDone = done.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.item, isFuture && { opacity: 0.5 }]}
              onPress={() => handleToggle(item)}
              onLongPress={() => setDraft({ id: item.id, name: item.name, assigneeId: item.assignee_id, days: item.days })}
              activeOpacity={0.6}
            >
              <View style={[styles.check, isDone && styles.checkDone]}>
                {isDone && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={[styles.itemText, isDone && styles.itemDone]}>{item.name}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={styles.empty}>
              {chores.length === 0 ? 'No chores yet. Tap + to add one.' : 'No chores this day'}
            </Text>
          ) : null
        }
        ListFooterComponent={
          chores.length > 0 ? <Text style={styles.hint}>Long-press a chore to edit or delete it</Text> : null
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setDraft({ id: null, name: '', assigneeId: null, days: ALL_DAYS })}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={!!draft} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
        <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
          <View style={styles.modal}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{draft?.id === null ? 'New chore' : 'Edit chore'}</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Empty the dishwasher"
                placeholderTextColor={colors.placeholder}
                value={draft?.name ?? ''}
                onChangeText={name => setDraft(d => d && ({ ...d, name }))}
                maxLength={200}
              />
              <Text style={styles.label}>Who</Text>
              <View style={styles.chips}>
                {[{ id: null as number | null, display_name: 'Anyone' }, ...members].map(m => {
                  const active = draft?.assigneeId === m.id;
                  return (
                    <TouchableOpacity
                      key={String(m.id)}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setDraft(d => d && ({ ...d, assigneeId: m.id }))}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.display_name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.label}>Days</Text>
              <View style={styles.chips}>
                {ALL_DAYS.map(n => {
                  const active = draft?.days.includes(n);
                  return (
                    <TouchableOpacity key={n} style={[styles.chip, active && styles.chipActive]} onPress={() => toggleDraftDay(n)}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{WEEKDAY_SHORT[n]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.actions}>
                {draft?.id !== null && (
                  <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={handleDelete}>
                    <Text style={styles.btnText}>Delete</Text>
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setDraft(null)}>
                  <Text style={[styles.btnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={handleSave}>
                  <Text style={styles.btnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    weekBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface,
    },
    weekArrow: { fontSize: 28, color: colors.primary, paddingHorizontal: 8 },
    weekLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
    dayStrip: {
      flexDirection: 'row', backgroundColor: colors.surface, paddingBottom: 8, paddingHorizontal: 6,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    day: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10 },
    dayActive: { backgroundColor: colors.primary },
    dayName: { fontSize: 12, color: colors.textFaint },
    dayNum: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 2 },
    dayTextActive: { color: colors.primaryText },
    dayToday: { color: colors.primary },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    sectionTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
    sectionCount: { fontSize: 13, color: colors.textFaint },
    item: {
      flexDirection: 'row', backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 15,
      borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center',
    },
    check: {
      width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border,
      justifyContent: 'center', alignItems: 'center', marginRight: 14,
    },
    checkDone: { backgroundColor: colors.success, borderColor: colors.success },
    checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
    itemText: { flex: 1, fontSize: 16, color: colors.text },
    itemDone: { color: colors.placeholder, textDecorationLine: 'line-through' },
    empty: { textAlign: 'center', color: colors.placeholder, marginTop: 80, fontSize: 15 },
    hint: { textAlign: 'center', color: colors.placeholder, fontSize: 12, marginTop: 16 },
    fab: {
      position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 4,
    },
    fabText: { color: colors.primaryText, fontSize: 30, lineHeight: 34 },
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    modal: { backgroundColor: colors.surface, borderRadius: 14, padding: 18, maxHeight: '90%' },
    modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
    input: {
      backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 16, color: colors.text,
    },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 14, marginBottom: 6 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 14, color: colors.text },
    chipTextActive: { color: colors.primaryText, fontWeight: '700' },
    actions: { flexDirection: 'row', gap: 8, marginTop: 20 },
    btn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
    btnGhost: { backgroundColor: colors.surfaceAlt },
    btnDanger: { backgroundColor: colors.danger },
    btnText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  });
}
