import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getRecipe, getGroceryLists, recipeToGrocery } from '../src/api/client';
import type { Recipe, RecipeIngredient, GroceryList } from '../src/api/types';
import { useTheme, type Colors } from '../src/theme';

const SCALES = [
  { label: 'Half', value: 0.5 },
  { label: 'As written', value: 1 },
  { label: '1½×', value: 1.5 },
  { label: 'Double', value: 2 },
  { label: 'Triple', value: 3 },
];

/** Canonical name and category are what actually go on the list, so two recipes wanting
 *  the same thing land on one line. Mirrors _ingredient_target in app/routers/recipes.py. */
function target(item: RecipeIngredient): { name: string; category: string } {
  if (item.ingredient) {
    return { name: item.ingredient.name, category: item.ingredient.category || 'Other' };
  }
  return { name: item.name, category: 'Other' };
}

export default function RecipeToGroceryScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipeId = Number(id);

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [listId, setListId] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [r, gl] = await Promise.all([getRecipe(recipeId), getGroceryLists()]);
        setRecipe(r);
        setLists(gl);
        setListId(gl[0]?.id ?? null);
        // Staples and optional extras start off: they're usually already in the kitchen,
        // and padding the list with salt every time makes it useless.
        const initial: Record<number, boolean> = {};
        for (const item of r.ingredients) {
          initial[item.id] = !item.optional && !item.ingredient?.is_staple;
        }
        setSelected(initial);
      } catch {
        Alert.alert('Error', 'Could not load this recipe');
      } finally {
        setLoading(false);
      }
    })();
  }, [recipeId]);

  const chosenCount = Object.values(selected).filter(Boolean).length;

  function setAll(value: boolean) {
    if (!recipe) return;
    const next: Record<number, boolean> = {};
    for (const item of recipe.ingredients) next[item.id] = value;
    setSelected(next);
  }

  async function handleAdd() {
    if (!recipe || listId == null) return;
    const ids = recipe.ingredients.filter(i => selected[i.id]).map(i => i.id);
    if (ids.length === 0) {
      Alert.alert('Nothing selected', 'Tick at least one ingredient to add.');
      return;
    }
    setSaving(true);
    try {
      const result = await recipeToGrocery(recipe.id, listId, ids, scale);
      const parts = [];
      if (result.added) parts.push(`${result.added} added`);
      if (result.merged) parts.push(`${result.merged} already on the list, amounts combined`);
      Alert.alert('Added to grocery list', parts.join(' · ') || 'Nothing changed.');
      router.back();
    } catch {
      Alert.alert('Error', 'Could not add these to the list');
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: 'Add to grocery list',
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    />
  );

  if (loading) {
    return <View style={styles.centered}>{header}<ActivityIndicator color={colors.primary} /></View>;
  }
  if (!recipe) {
    return <View style={styles.centered}>{header}<Text style={styles.empty}>Recipe not available.</Text></View>;
  }
  if (lists.length === 0) {
    return (
      <View style={styles.centered}>
        {header}
        <Text style={styles.empty}>You don't have a grocery list yet. Create one on the Grocery tab first.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>List</Text>
        <View style={styles.chipRow}>
          {lists.map(l => (
            <TouchableOpacity
              key={l.id}
              style={[styles.chip, listId === l.id && styles.chipActive]}
              onPress={() => setListId(l.id)}
            >
              <Text style={[styles.chipText, listId === l.id && styles.chipTextActive]}>{l.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>
          Servings{recipe.servings ? ` (recipe makes ${recipe.servings})` : ''}
        </Text>
        <View style={styles.chipRow}>
          {SCALES.map(s => (
            <TouchableOpacity
              key={s.value}
              style={[styles.chip, scale === s.value && styles.chipActive]}
              onPress={() => setScale(s.value)}
            >
              <Text style={[styles.chipText, scale === s.value && styles.chipTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.listHeaderRow}>
          <Text style={styles.sectionHeader}>Ingredients ({chosenCount})</Text>
          <View style={styles.selectButtons}>
            <TouchableOpacity onPress={() => setAll(true)}><Text style={styles.selectLink}>All</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setAll(false)}><Text style={styles.selectLink}>None</Text></TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          {recipe.ingredients.map(item => {
            const { name, category } = target(item);
            const isStaple = !!item.ingredient?.is_staple;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.row}
                onPress={() => setSelected(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
              >
                <Ionicons
                  name={selected[item.id] ? 'checkbox' : 'square-outline'}
                  size={21}
                  color={selected[item.id] ? colors.primary : colors.textFaint}
                />
                <View style={styles.rowMain}>
                  <Text style={[styles.rowName, !selected[item.id] && styles.rowDim]}>{name}</Text>
                  <Text style={styles.rowRaw} numberOfLines={1}>{item.raw_text}</Text>
                </View>
                <View style={styles.rowTags}>
                  <Text style={styles.categoryChip}>{category}</Text>
                  {(isStaple || item.optional) && (
                    <Text style={styles.noteChip}>{isStaple ? 'staple' : 'optional'}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.hint}>
          Staples and optional extras start unticked. Anything already on the list has its
          amount combined rather than duplicated.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleAdd} disabled={saving}>
          <Text style={styles.primaryButtonText}>
            {saving ? 'Adding…' : `Add ${chosenCount} to list`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
    content: { padding: 14, paddingBottom: 20 },
    sectionHeader: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8,
      color: colors.textFaint, marginTop: 14, marginBottom: 7,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    chip: { backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipActive: { backgroundColor: colors.primary },
    chipText: { fontSize: 13, color: colors.chipText },
    chipTextActive: { color: colors.primaryText, fontWeight: '600' },
    listHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    selectButtons: { flexDirection: 'row', gap: 14, marginTop: 7 },
    selectLink: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    card: { backgroundColor: colors.surface, borderRadius: 10, overflow: 'hidden' },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    rowMain: { flex: 1 },
    rowName: { fontSize: 14.5, fontWeight: '600', color: colors.text },
    rowDim: { color: colors.textMuted, fontWeight: '400' },
    rowRaw: { fontSize: 11.5, color: colors.textFaint, marginTop: 1 },
    rowTags: { alignItems: 'flex-end', gap: 3 },
    categoryChip: {
      fontSize: 10.5, color: colors.chipText, backgroundColor: colors.chip,
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
    },
    noteChip: { fontSize: 10, color: colors.textFaint },
    hint: { fontSize: 12, color: colors.textFaint, marginTop: 12, lineHeight: 17 },
    footer: {
      padding: 12, backgroundColor: colors.surface,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    primaryButton: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
    primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    empty: { color: colors.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  });
}
