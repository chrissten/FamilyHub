import { useState, useCallback } from 'react';
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

export default function GroceryScreen() {
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [selectedList, setSelectedList] = useState<GroceryList | null>(null);
  const [categories, setCategories] = useState<GroceryCategory[]>([]);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [newQty, setNewQty] = useState('');
  const [storeMode, setStoreMode] = useState(false);

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

  async function handleAdd() {
    if (!newItem.trim() || !selectedList) return;
    const defaultCat = categories[0];
    if (!defaultCat) {
      Alert.alert('No categories', 'This list has no categories. Add one on the web app first.');
      return;
    }
    try {
      const item = await addGroceryItem(
        selectedList.id, newItem.trim(), defaultCat.id,
        newQty.trim() || undefined,
      );
      setItems(prev => [...prev, item]);
      setNewItem('');
      setNewQty('');
    } catch {
      Alert.alert('Error', 'Could not add item');
    }
  }

  const sections = categories.map(cat => ({
    key: String(cat.id),
    title: cat.name,
    data: items.filter(i => i.category_id === cat.id && (!storeMode || !i.checked)),
  })).filter(s => s.data.length > 0);

  const orphaned = items.filter(i =>
    !categories.some(c => c.id === i.category_id) && (!storeMode || !i.checked)
  );
  if (orphaned.length > 0) {
    sections.push({ key: 'other', title: 'Other', data: orphaned });
  }

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
        sections={sections}
        keyExtractor={item => String(item.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadLists} />}
        renderSectionHeader={({ section }) => (
          <Text style={styles.catHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
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
              </Text>
              {!!item.quantity && (
                <Text style={styles.itemQty}>{item.quantity}</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={styles.empty}>
              {selectedList ? 'List is empty — add something below' : 'No grocery lists found'}
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 80 }}
      />

      {selectedList && !storeMode && (
        <View style={styles.addBar}>
          <TextInput
            style={[styles.addInput, { flex: 3 }]}
            placeholder="Add item…"
            value={newItem}
            onChangeText={setNewItem}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TextInput
            style={[styles.addInput, { flex: 1 }]}
            placeholder="Qty"
            value={newQty}
            onChangeText={setNewQty}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      )}
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
  tabText: { color: '#999', fontSize: 14 },
  tabTextActive: { color: '#4A90D9', fontWeight: '600' },
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 6,
  },
  stats: { fontSize: 12, color: '#999' },
  storeModeBtn: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff',
  },
  storeModeBtnActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  storeModeBtnText: { fontSize: 12, color: '#666', fontWeight: '500' },
  storeModeBtnTextActive: { color: '#fff' },
  catHeader: {
    fontSize: 11, fontWeight: '700', color: '#999',
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
    backgroundColor: '#f5f5f5',
  },
  item: {
    flexDirection: 'row', backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  check: {
    width: 22, height: 22, borderRadius: 4,
    borderWidth: 2, borderColor: '#ccc',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  checkDone: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  itemBody: { flex: 1 },
  itemName: { fontSize: 16, color: '#1a1a1a' },
  itemDone: { color: '#c0c0c0', textDecorationLine: 'line-through' },
  itemQty: { fontSize: 12, color: '#aaa', marginTop: 2 },
  empty: { textAlign: 'center', color: '#bbb', marginTop: 60, fontSize: 15 },
  addBar: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#e0e0e0',
    padding: 8, gap: 6,
  },
  addInput: {
    backgroundColor: '#f5f5f5', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  addBtn: {
    backgroundColor: '#4A90D9', borderRadius: 8,
    paddingHorizontal: 14, justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
