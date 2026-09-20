import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, RefreshControl, Modal,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getMealPlan, addMealPlanEntry, deleteMealPlanEntry, getRecipes,
} from '../src/api/client';
import type { MealPlanEntry, RecipeSummary } from '../src/api/types';
import { useTheme, type Colors } from '../src/theme';

type Slot = 'breakfast' | 'lunch' | 'dinner';
const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner'];
const SLOT_LABELS: Record<Slot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday of the week containing `d`. Mirrors week_start() in app/meal_plan.py. */
function weekStart(d: Date): Date {
  const copy = new Date(d);
  const weekday = (copy.getDay() + 6) % 7; // JS weeks start Sunday; ours start Monday.
  copy.setDate(copy.getDate() - weekday);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Local YYYY-MM-DD. Deliberately not toISOString(), which converts to UTC and can
 *  shift the date by a day depending on the timezone. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MealPlanScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();

  const [monday, setMonday] = useState(() => weekStart(new Date()));
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState<{ date: string; slot: Slot } | null>(null);

  useFocusEffect(useCallback(() => { load(); }, [monday]));

  async function load() {
    setRefreshing(true);
    try {
      const [plan, list] = await Promise.all([getMealPlan(isoDate(monday)), getRecipes()]);
      setEntries(plan);
      setRecipes(list);
    } catch {
      Alert.alert('Error', 'Could not load the meal plan');
    } finally {
      setRefreshing(false);
    }
  }

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  }), [monday]);

  const todayIso = isoDate(new Date());

  function shiftWeek(weeks: number) {
    const next = new Date(monday);
    next.setDate(next.getDate() + weeks * 7);
    setMonday(next);
  }

  async function handlePick(recipe: RecipeSummary) {
    if (!picking) return;
    const target = picking;
    setPicking(null);
    try {
      const entry = await addMealPlanEntry(recipe.id, target.date, target.slot);
      setEntries(prev => [...prev, entry]);
    } catch {
      Alert.alert('Error', 'Could not add that to the plan');
    }
  }

  function confirmRemove(entry: MealPlanEntry) {
    Alert.alert('Remove from plan', `Remove "${entry.recipe.title}"? This also removes it from the calendar.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMealPlanEntry(entry.id);
            setEntries(prev => prev.filter(e => e.id !== entry.id));
          } catch {
            Alert.alert('Error', 'Could not remove that');
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Meal plan',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      />

      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => shiftWeek(-1)} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.weekLabel}>
          {MONTHS[monday.getMonth()]} {monday.getDate()} – {MONTHS[days[6].getMonth()]} {days[6].getDate()}
        </Text>
        <TouchableOpacity onPress={() => shiftWeek(1)} hitSlop={10}>
          <Ionicons name="chevron-forward" size={22} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMonday(weekStart(new Date()))}>
          <Text style={styles.todayLink}>Today</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} colors={[colors.primary]} tintColor={colors.primary} />}
        contentContainerStyle={styles.content}
      >
        {days.map((day, index) => {
          const iso = isoDate(day);
          return (
            <View key={iso} style={[styles.dayCard, iso === todayIso && styles.dayToday]}>
              <Text style={styles.dayHeader}>
                {DAY_NAMES[index]} <Text style={styles.dayNum}>{MONTHS[day.getMonth()]} {day.getDate()}</Text>
              </Text>
              {SLOTS.map(slot => {
                const slotEntries = entries.filter(e => e.date === iso && e.meal_slot === slot);
                return (
                  <View key={slot} style={styles.slot}>
                    <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
                    {slotEntries.map(entry => (
                      <View key={entry.id} style={styles.entryRow}>
                        <TouchableOpacity style={styles.entryMain} onPress={() => router.push(`/recipe-detail?id=${entry.recipe.id}`)}>
                          <Text style={styles.entryTitle} numberOfLines={1}>{entry.recipe.title}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmRemove(entry)} hitSlop={8}>
                          <Ionicons name="close" size={16} color={colors.textFaint} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity style={styles.addSlot} onPress={() => setPicking({ date: iso, slot })}>
                      <Ionicons name="add" size={14} color={colors.textFaint} />
                      <Text style={styles.addSlotText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          );
        })}
        <Text style={styles.note}>
          Planned meals also show on the family calendar as all-day events. Removing one
          here removes it there; deleting it from the calendar just unlinks it.
        </Text>
      </ScrollView>

      {/* Routed screens are preferred for text entry, but this is a scroll-and-tap list
          with no keyboard, so a plain Modal is fine here. */}
      <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <TouchableOpacity style={styles.overlay} onPress={() => setPicking(null)} activeOpacity={1}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>
              {picking ? `${SLOT_LABELS[picking.slot]} on ${picking.date}` : ''}
            </Text>
            <ScrollView style={styles.sheetScroll}>
              {recipes.length === 0 ? (
                <Text style={styles.empty}>No recipes yet.</Text>
              ) : recipes.map(r => (
                <TouchableOpacity key={r.id} style={styles.sheetRow} onPress={() => handlePick(r)}>
                  <Text style={styles.sheetRowText}>{r.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setPicking(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    weekNav: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    weekLabel: { flex: 1, textAlign: 'center', fontSize: 14.5, fontWeight: '600', color: colors.text },
    todayLink: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    content: { padding: 12, paddingBottom: 40 },
    dayCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 9 },
    dayToday: { borderWidth: 2, borderColor: colors.primary },
    dayHeader: { fontSize: 14.5, fontWeight: '700', color: colors.text, marginBottom: 4 },
    dayNum: { fontWeight: '400', color: colors.textFaint, fontSize: 12.5 },
    slot: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 6 },
    slotLabel: {
      fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.7,
      color: colors.textFaint, fontWeight: '700',
    },
    entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
    entryMain: { flex: 1 },
    entryTitle: { fontSize: 14, color: colors.text },
    addSlot: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5 },
    addSlotText: { fontSize: 12, color: colors.textFaint },
    note: { fontSize: 12, color: colors.textFaint, marginTop: 10, lineHeight: 17, textAlign: 'center' },
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, maxHeight: '75%' },
    sheetTitle: { fontSize: 15, fontWeight: '700', color: colors.text, paddingHorizontal: 18, marginBottom: 10 },
    sheetScroll: { maxHeight: 380 },
    sheetRow: { paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    sheetRowText: { fontSize: 15, color: colors.text },
    sheetCancel: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border },
    sheetCancelText: { fontSize: 15, color: colors.primary, fontWeight: '600' },
    empty: { padding: 20, color: colors.textMuted, textAlign: 'center' },
  });
}
