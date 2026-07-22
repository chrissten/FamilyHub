import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, SectionList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, TextInput,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getGroceryLists, getGroceryCategories, getGroceryItems,
  addGroceryItem, toggleGroceryItem, deleteGroceryItem,
} from '../../src/api/client';
import type { GroceryList, GroceryCategory, GroceryItem } from '../../src/api/types';
import { useTheme, type Colors } from '../../src/theme';
import { useKeyboardHeight } from '../../src/useKeyboardHeight';

interface DraftItem {
  text: string;
  qty: string;
}

export default function GroceryScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const keyboardHeight = useKeyboardHeight();
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [selectedList, setSelectedList] = useState<GroceryList | null>(null);
  const [categories, setCategories] = useState<GroceryCategory[]>([]);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, DraftItem>>({});
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<number, boolean>>({});
  const [storeMode, setStoreMode] = useState(false);
  const [matchedItemId, setMatchedItemId] = useState<number | null>(null);
  const sectionListRef = useRef<SectionList<GroceryItem>>(null);
  const handledMatchRef = useRef<number | null>(null);

  useFocusEffect(useCallback(() => { loadLists(); }, []));

  async function loadLists() {
    setRefreshing(true);
    try {
      const data = await getGroceryLists();
      setLists(data);
      const current = selectedList ? data.find(l => l.id === selectedList.id) : data[0];
      if (current) await loadList(current);
    } catch {
      Alert.alert('Error', 'Could not load grocery lists');
    } finally {
      setRefreshing(false);
    }
  }

  async function loadList(list: GroceryList) {
    setSelectedList(list);
    const [cats, its] = await Promise.all([
      getGroceryCategories(list.id),
      getGroceryItems(list.id),
    ]);
    setCategories(cats.sort((a, b) => a.sort_order - b.sort_order));
    setItems(its);
  }

  async function handleToggle(item: GroceryItem) {
    try {
      const updated = await toggleGroceryItem(item.id);
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    } catch {
      Alert.alert('Error', 'Could not update item');
    }
  }

  async function handleDelete(item: GroceryItem) {
    Alert.alert('Remove', `Remove "${item.name}" from list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await deleteGroceryItem(item.id);
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch {
            Alert.alert('Error', 'Could not remove item');
          }
        },
      },
    ]);
  }

  function toggleCategory(categoryId: number) {
    setExpandedCategories(prev => ({ ...prev, [categoryId]: !prev[categoryId] }));
  }

  function getDraft(categoryId: number): DraftItem {
    return drafts[categoryId] ?? { text: '', qty: '' };
  }

  function setDraftText(categoryId: number, text: string) {
    setActiveCategoryId(categoryId);
    setDrafts(prev => ({ ...prev, [categoryId]: { ...getDraft(categoryId), text } }));
  }

  function setDraftQty(categoryId: number, qty: string) {
    setDrafts(prev => ({ ...prev, [categoryId]: { ...getDraft(categoryId), qty } }));
  }

  /** Keeps a category's add-item row from staying hidden behind the keyboard when it's
   *  focused — the screen has no fixed add bar to push up (see useKeyboardHeight), so
   *  instead scroll the last item of that category (immediately above its footer) to
   *  the bottom of the visible area. */
  function focusCategoryInput(categoryId: number) {
    const secs = buildSections();
    const sectionIndex = secs.findIndex(s => s.categoryId === categoryId);
    if (sectionIndex < 0) return;
    const data = secs[sectionIndex].data;
    if (data.length === 0) return;
    try {
      sectionListRef.current?.scrollToLocation({
        sectionIndex, itemIndex: data.length - 1, viewPosition: 1, animated: true,
      });
    } catch {
      // list not measured yet — ignore
    }
  }

  async function handleAdd(categoryId: number) {
    const draft = getDraft(categoryId);
    if (!draft.text.trim() || !selectedList) return;
    try {
      const item = await addGroceryItem(
        selectedList.id, draft.text.trim(), categoryId,
        draft.qty.trim() || undefined,
      );
      setItems(prev => [...prev, item]);
      setDrafts(prev => ({ ...prev, [categoryId]: { text: '', qty: '' } }));
    } catch {
      Alert.alert('Error', 'Could not add item');
    }
  }

  function buildSections() {
    const secs: { key: string; title: string; categoryId: number | null; expanded: boolean; data: GroceryItem[] }[] =
      categories.map(cat => {
        // Store Mode always shows everything; otherwise a category starts collapsed
        // until the user taps it open.
        const catExpanded = storeMode || !!expandedCategories[cat.id];
        return {
          key: String(cat.id),
          title: cat.name,
          categoryId: cat.id,
          expanded: catExpanded,
          data: catExpanded ? items.filter(i => i.category_id === cat.id && (!storeMode || !i.checked)) : [],
        };
      });

    const orphaned = items.filter(i =>
      !categories.some(c => c.id === i.category_id) && (!storeMode || !i.checked)
    );
    if (orphaned.length > 0) {
      secs.push({ key: 'other', title: 'Other', categoryId: null, expanded: true, data: orphaned });
    }

    // In store mode, hide categories with nothing left to buy; otherwise keep
    // every category visible (even empty/collapsed ones) so there's always somewhere to add to.
    return storeMode ? secs.filter(s => s.data.length > 0) : secs;
  }

  const sections = buildSections();

  useEffect(() => {
    const activeText = activeCategoryId != null ? getDraft(activeCategoryId).text : '';
    const trimmed = activeText.trim().toLowerCase();
    if (!trimmed) {
      setMatchedItemId(null);
      handledMatchRef.current = null;
      return;
    }
    const match = items.find(i => i.name.trim().toLowerCase() === trimmed);
    if (!match) {
      setMatchedItemId(null);
      handledMatchRef.current = null;
      return;
    }
    setMatchedItemId(match.id);
    if (handledMatchRef.current === match.id) return;

    if (!storeMode && !expandedCategories[match.category_id]) {
      setExpandedCategories(prev => ({ ...prev, [match.category_id]: true }));
      return; // re-run once the category above expands so scrollToLocation can find it
    }
    handledMatchRef.current = match.id;

    const secs = buildSections();
    for (let sectionIndex = 0; sectionIndex < secs.length; sectionIndex++) {
      const itemIndex = secs[sectionIndex].data.findIndex(i => i.id === match.id);
      if (itemIndex >= 0) {
        try {
          sectionListRef.current?.scrollToLocation({ sectionIndex, itemIndex, viewPosition: 0.3, animated: true });
        } catch {
          // list not measured yet — ignore, the highlight still shows once rendered
        }
        break;
      }
    }
    if (match.checked) handleToggle(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, activeCategoryId, items, categories, storeMode, expandedCategories]);

  const remaining = items.filter(i => !i.checked).length;

  return (
    <View style={styles.container}>
      {lists.length > 0 && (
        <View style={styles.tabs}>
          {lists.map(list => (
            <TouchableOpacity
              key={list.id}
              style={[styles.tab, selectedList?.id === list.id && styles.tabActive]}
              onPress={() => loadList(list)}
            >
              <Text style={[styles.tabText, selectedList?.id === list.id && styles.tabTextActive]}>
                {list.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {selectedList && (
        <View style={styles.statsRow}>
          <Text style={styles.stats}>
            {remaining === 0 ? 'All done!' : `${remaining} item${remaining !== 1 ? 's' : ''} remaining`}
          </Text>
          <TouchableOpacity
            style={[styles.storeModeBtn, storeMode && styles.storeModeBtnActive]}
            onPress={() => setStoreMode(v => !v)}
          >
            <Text style={[styles.storeModeBtnText, storeMode && styles.storeModeBtnTextActive]}>
              🛒 Store Mode
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <SectionList
        ref={sectionListRef}
        sections={sections}
        keyExtractor={item => String(item.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadLists} />}
        renderSectionHeader={({ section }) => {
          const collapsible = !storeMode && section.categoryId != null;
          return (
            <TouchableOpacity
              style={styles.catHeaderRow}
              activeOpacity={collapsible ? 0.6 : 1}
              disabled={!collapsible}
              onPress={() => section.categoryId != null && toggleCategory(section.categoryId)}
            >
              <Text style={styles.catHeader}>{section.title}</Text>
              {collapsible && (
                <Text style={styles.catChevron}>{section.expanded ? '▾' : '▸'}</Text>
              )}
            </TouchableOpacity>
          );
        }}
        renderSectionFooter={({ section }) => {
          if (storeMode || section.categoryId == null || !section.expanded) return null;
          const draft = getDraft(section.categoryId);
          const categoryId = section.categoryId;
          return (
            <View style={styles.catAddRow}>
              <TextInput
                style={[styles.addInput, { flex: 3 }]}
                placeholder="Add item…"
                value={draft.text}
                onChangeText={text => setDraftText(categoryId, text)}
                onFocus={() => focusCategoryInput(categoryId)}
                returnKeyType="done"
                onSubmitEditing={() => handleAdd(categoryId)}
                placeholderTextColor={colors.placeholder}
              />
              <TextInput
                style={[styles.addInput, { flex: 1 }]}
                placeholder="Qty"
                value={draft.qty}
                onChangeText={qty => setDraftQty(categoryId, qty)}
                onFocus={() => focusCategoryInput(categoryId)}
                returnKeyType="done"
                onSubmitEditing={() => handleAdd(categoryId)}
                placeholderTextColor={colors.placeholder}
              />
              <TouchableOpacity style={styles.addBtn} onPress={() => handleAdd(categoryId)}>
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.item, item.id === matchedItemId && styles.itemHighlighted]}
            onPress={() => handleToggle(item)}
            onLongPress={() => !storeMode && handleDelete(item)}
            activeOpacity={0.6}
          >
            <View style={[styles.check, item.checked && styles.checkDone]}>
              {item.checked && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <View style={styles.itemBody}>
              <Text style={[styles.itemName, item.checked && styles.itemDone]}>
                {item.name}
                {!!item.quantity && (
                  <Text style={styles.itemQty}> ({item.quantity})</Text>
                )}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={styles.empty}>
              {!selectedList
                ? 'No grocery lists found'
                : categories.length === 0
                  ? 'This list has no categories. Add one on the web app first.'
                  : 'List is empty — add something below'}
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 80 + keyboardHeight }}
      />
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
    tabText: { color: colors.textFaint, fontSize: 14 },
    tabTextActive: { color: colors.primary, fontWeight: '600' },
    statsRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 6,
    },
    stats: { fontSize: 12, color: colors.textFaint },
    storeModeBtn: {
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    storeModeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    storeModeBtnText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
    storeModeBtnTextActive: { color: colors.primaryText },
    catHeaderRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
      backgroundColor: colors.background,
    },
    catHeader: {
      fontSize: 11, fontWeight: '700', color: colors.textFaint,
      textTransform: 'uppercase', letterSpacing: 0.8,
    },
    catChevron: { fontSize: 12, color: colors.textFaint },
    item: {
      flexDirection: 'row', backgroundColor: colors.surface,
      paddingHorizontal: 16, paddingVertical: 13,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      alignItems: 'center',
    },
    check: {
      width: 22, height: 22, borderRadius: 4,
      borderWidth: 2, borderColor: colors.border,
      justifyContent: 'center', alignItems: 'center', marginRight: 14,
    },
    checkDone: { backgroundColor: colors.primary, borderColor: colors.primary },
    itemHighlighted: { backgroundColor: colors.primary + '22' },
    checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
    itemBody: { flex: 1 },
    itemName: { fontSize: 16, color: colors.text },
    itemDone: { color: colors.placeholder, textDecorationLine: 'line-through' },
    itemQty: { fontSize: 14, color: colors.textFaint },
    empty: { textAlign: 'center', color: colors.placeholder, marginTop: 60, fontSize: 15 },
    catAddRow: {
      flexDirection: 'row', backgroundColor: colors.background,
      paddingHorizontal: 16, paddingTop: 4, paddingBottom: 14, gap: 6,
    },
    addInput: {
      backgroundColor: colors.surfaceAlt, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text,
    },
    addBtn: {
      backgroundColor: colors.primary, borderRadius: 8,
      paddingHorizontal: 14, justifyContent: 'center',
    },
    addBtnText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  });
}
