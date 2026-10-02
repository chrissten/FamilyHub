import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getGroceryLists, getGroceryCategories, getGroceryItems, addGroceryItem, toggleGroceryItem,
  useTheme, type Colors, type GroceryList, type GroceryCategory, type GroceryItem,
} from '../../src/shared';

const REFRESH_MS = 60 * 1000;
// Same fallback bucket the server uses (app/grocery_ops.py DEFAULT_CATEGORY_NAME).
const DEFAULT_CATEGORY_NAME = 'Other';

/** Kid-friendly grocery list: type it, (optionally) pick an aisle, tap Add. Items can be
 *  ticked off but not deleted from here. */
export default function GroceryScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [list, setList] = useState<GroceryList | null>(null);
  const [categories, setCategories] = useState<GroceryCategory[]>([]);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultCategoryId = useMemo(
    () => (categories.find(c => c.name.toLowerCase() === DEFAULT_CATEGORY_NAME.toLowerCase()) ?? categories[0])?.id ?? null,
    [categories],
  );

  const load = useCallback(async (target?: GroceryList) => {
    try {
      const all = await getGroceryLists();
      setLists(all);
      const current = (target && all.find(l => l.id === target.id)) ?? (list && all.find(l => l.id === list.id)) ?? all[0];
      if (!current) return;
      const [cats, its] = await Promise.all([getGroceryCategories(current.id), getGroceryItems(current.id)]);
      setList(current);
      setCategories(cats.sort((a, b) => a.sort_order - b.sort_order));
      setItems(its);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  function showFlash(message: string) {
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3000);
  }

  async function handleAdd() {
    const trimmed = name.trim();
    const cat = categoryId ?? defaultCategoryId;
    if (!trimmed || !list || cat === null || adding) return;
    setAdding(true);
    try {
      const item = await addGroceryItem(list.id, trimmed, cat, qty.trim() || undefined);
      // The server merges duplicates into the existing row, so replace rather than append.
      setItems(prev => [...prev.filter(i => i.id !== item.id), item]);
      setName('');
      setQty('');
      setCategoryId(null);
      showFlash(`Added ${item.name}!`);
    } catch {
      showFlash('Could not add that. Try again?');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(item: GroceryItem) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i));
    try {
      const updated = await toggleGroceryItem(item.id);
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? item : i));
    }
  }

  const byCategory = useMemo(() => {
    const known = new Set(categories.map(c => c.id));
    return categories
      .map(c => ({
        category: c,
        items: items
          .filter(i => i.category_id === c.id || (c.id === defaultCategoryId && !known.has(i.category_id)))
          .sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name)),
      }))
      .filter(g => g.items.length > 0);
  }, [categories, items, defaultCategoryId]);

  const remaining = items.filter(i => !i.checked).length;
  const selectedCat = categoryId ?? defaultCategoryId;

  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.addPanel} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.panelTitle}>What do we need?</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. apples"
          placeholderTextColor={colors.placeholder}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.qtyInput}
          value={qty}
          onChangeText={setQty}
          placeholder="How many? (optional)"
          placeholderTextColor={colors.placeholder}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
        <Text style={styles.sectionLabel}>Where is it in the store?</Text>
        <View style={styles.catGrid}>
          {categories.map(c => {
            const active = c.id === selectedCat;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.catChip, active && styles.catChipActive]}
                onPress={() => setCategoryId(c.id)}
              >
                <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.addBtn, (!name.trim() || adding) && styles.addBtnDisabled]}
          onPress={handleAdd}
          disabled={!name.trim() || adding}
        >
          <Ionicons name="add-circle" size={30} color={colors.primaryText} />
          <Text style={styles.addBtnText}>Add to list</Text>
        </TouchableOpacity>
        {flash && <Text style={styles.flash}>{flash}</Text>}
      </ScrollView>

      <View style={styles.listPanel}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>{list?.name ?? 'Grocery'}</Text>
          <Text style={styles.listCount}>{remaining} to get</Text>
          {error && <Ionicons name="cloud-offline-outline" size={24} color={colors.danger} />}
          <View style={{ flex: 1 }} />
          {lists.length > 1 && lists.map(l => (
            <TouchableOpacity
              key={l.id}
              style={[styles.listChip, l.id === list?.id && styles.catChipActive]}
              onPress={() => { setLoading(true); load(l); }}
            >
              <Text style={[styles.catChipText, l.id === list?.id && styles.catChipTextActive]}>{l.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView contentContainerStyle={styles.cards}>
          {byCategory.length === 0 && <Text style={styles.empty}>The list is empty.</Text>}
          {byCategory.map(({ category, items: catItems }) => (
            <View key={category.id} style={styles.card}>
              <Text style={styles.cardTitle}>{category.name}</Text>
              {catItems.map(item => (
                <TouchableOpacity key={item.id} style={styles.item} onPress={() => handleToggle(item)}>
                  <Ionicons
                    name={item.checked ? 'checkbox' : 'square-outline'}
                    size={26}
                    color={item.checked ? colors.success : colors.textFaint}
                  />
                  <Text style={[styles.itemText, item.checked && styles.itemChecked]} numberOfLines={2}>
                    {item.name}{item.quantity ? <Text style={styles.itemQty}>  {item.quantity}</Text> : null}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, flexDirection: 'row' },
    addPanel: { width: 400, flexGrow: 0, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border },
    panelTitle: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 14 },
    nameInput: {
      fontSize: 24, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 14, borderWidth: 2, borderColor: colors.primary,
    },
    qtyInput: {
      fontSize: 18, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: 12,
      paddingHorizontal: 16, paddingVertical: 10, marginTop: 10,
    },
    sectionLabel: { fontSize: 16, fontWeight: '600', color: colors.textMuted, marginTop: 18, marginBottom: 8 },
    catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    catChip: {
      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    catChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    catChipText: { fontSize: 15, color: colors.text },
    catChipTextActive: { color: colors.primaryText, fontWeight: '700' },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      marginTop: 22, paddingVertical: 16, borderRadius: 16, backgroundColor: colors.primary,
    },
    addBtnDisabled: { opacity: 0.4 },
    addBtnText: { fontSize: 22, fontWeight: '700', color: colors.primaryText },
    flash: { fontSize: 18, color: colors.success, fontWeight: '600', textAlign: 'center', marginTop: 14 },
    listPanel: { flex: 1 },
    listHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
    },
    listTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
    listCount: { fontSize: 17, color: colors.textMuted },
    listChip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 16, alignItems: 'flex-start' },
    empty: { fontSize: 20, color: colors.textFaint, padding: 20 },
    card: {
      width: '31.5%', backgroundColor: colors.surface, borderRadius: 16, padding: 14,
      borderWidth: 1, borderColor: colors.border,
    },
    cardTitle: { fontSize: 18, fontWeight: '700', color: colors.primary, marginBottom: 6 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    itemText: { fontSize: 19, color: colors.text, flexShrink: 1 },
    itemChecked: { color: colors.textFaint, textDecorationLine: 'line-through' },
    itemQty: { fontSize: 15, color: colors.textMuted },
  });
}
