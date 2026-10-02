import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getChores, getChoreCompletions, getUsers, toggleChore, isoDate, WEEKDAY_NAMES, MONTH_NAMES,
  useTheme, type Colors, type Chore, type User,
} from '../../src/shared';
import { useNow } from '../../src/WeekBoard';

const REFRESH_MS = 60 * 1000;

interface Column {
  key: string;
  title: string;
  color: string | null;
  chores: Chore[];
}

/** Today's chores, one column per person (plus "Anyone"). Tap a chore to tick it off, tap
 *  again to undo. Only today is editable from here; the full week lives on the web app. */
export default function ChoresScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const now = useNow();
  const today = isoDate(now);
  const weekday = now.getDay();

  const [chores, setChores] = useState<Chore[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cs, users, completions] = await Promise.all([
        getChores(), getUsers(), getChoreCompletions(today, today),
      ]);
      setChores(cs);
      setMembers(users);
      setDone(new Set(completions.map(c => c.chore_id)));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [today]);

  // Reloads on mount, every minute, and when midnight rolls `today` over.
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function handleToggle(chore: Chore) {
    const wasDone = done.has(chore.id);
    const flip = (on: boolean) => setDone(prev => {
      const next = new Set(prev);
      if (on) next.add(chore.id); else next.delete(chore.id);
      return next;
    });
    flip(!wasDone);
    try {
      const result = await toggleChore(chore.id, today);
      flip(result.done);
    } catch {
      flip(wasDone);
    }
  }

  const columns = useMemo<Column[]>(() => {
    const due = chores.filter(c => c.days.includes(weekday));
    const cols: Column[] = members
      .map(m => ({
        key: String(m.id), title: m.display_name, color: m.color_hex,
        chores: due.filter(c => c.assignee_id === m.id),
      }))
      .filter(col => col.chores.length > 0);
    const anyone = due.filter(c => c.assignee_id === null);
    if (anyone.length > 0) cols.push({ key: 'anyone', title: 'Anyone', color: null, chores: anyone });
    return cols;
  }, [chores, members, weekday]);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Chores</Text>
        <Text style={styles.date}>{WEEKDAY_NAMES[weekday]}, {MONTH_NAMES[now.getMonth()]} {now.getDate()}</Text>
        {error && <Ionicons name="cloud-offline-outline" size={24} color={colors.danger} />}
      </View>

      {columns.length === 0 ? (
        <Text style={styles.empty}>
          {chores.length === 0 ? 'No chores yet. Add some on the FamilyHub website.' : 'No chores today. Enjoy!'}
        </Text>
      ) : (
        <ScrollView horizontal contentContainerStyle={styles.columns}>
          {columns.map(col => {
            const doneCount = col.chores.filter(c => done.has(c.id)).length;
            const allDone = doneCount === col.chores.length;
            return (
              <View key={col.key} style={[styles.column, allDone && styles.columnDone]}>
                <View style={[styles.columnHeader, col.color ? { backgroundColor: col.color } : styles.anyoneHeader]}>
                  <Text style={styles.columnName} numberOfLines={1}>{col.title}</Text>
                  <Text style={styles.columnCount}>
                    {allDone ? 'All done!' : `${doneCount} of ${col.chores.length}`}
                  </Text>
                </View>
                <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
                  {col.chores.map(chore => {
                    const isDone = done.has(chore.id);
                    return (
                      <TouchableOpacity
                        key={chore.id}
                        style={[styles.chore, isDone && styles.choreDone]}
                        onPress={() => handleToggle(chore)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={isDone ? 'checkmark-circle' : 'ellipse-outline'}
                          size={40}
                          color={isDone ? colors.success : colors.textFaint}
                        />
                        <Text style={[styles.choreText, isDone && styles.choreTextDone]} numberOfLines={3}>
                          {chore.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
    },
    title: { fontSize: 24, fontWeight: '700', color: colors.text },
    date: { fontSize: 18, color: colors.textMuted },
    empty: { fontSize: 22, color: colors.textFaint, padding: 30 },
    columns: { padding: 16, gap: 16, flexGrow: 1 },
    column: {
      width: 340, backgroundColor: colors.surface, borderRadius: 18, overflow: 'hidden',
      borderWidth: 2, borderColor: colors.border,
    },
    columnDone: { borderColor: colors.success },
    columnHeader: { paddingHorizontal: 16, paddingVertical: 14 },
    anyoneHeader: { backgroundColor: colors.textMuted },
    columnName: { fontSize: 26, fontWeight: '800', color: '#ffffff' },
    columnCount: { fontSize: 16, fontWeight: '600', color: '#ffffff', marginTop: 2 },
    chore: {
      flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    choreDone: { backgroundColor: colors.successBg, borderColor: colors.success },
    choreText: { fontSize: 22, fontWeight: '600', color: colors.text, flexShrink: 1 },
    choreTextDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  });
}
