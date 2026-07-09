import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, TextInput,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getTodoLists, getTodoItems, addTodoItem, toggleTodoItem, deleteTodoItem } from '../../src/api/client';
import type { TodoList, TodoItem } from '../../src/api/types';

export default function TodoScreen() {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [selectedList, setSelectedList] = useState<TodoList | null>(null);
  const [items, setItems] = useState<TodoItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newItem, setNewItem] = useState('');

  useFocusEffect(useCallback(() => { loadLists(); }, []));

  async function loadLists() {
    setRefreshing(true);
    try {
      const data = await getTodoLists();
      setLists(data);
      const current = selectedList ? data.find(l => l.id === selectedList.id) : data[0];
      if (current) await loadList(current);
    } catch {
      Alert.alert('Error', 'Could not load to-do lists');
    } finally {
      setRefreshing(false);
    }
  }

  async function loadList(list: TodoList) {
    setSelectedList(list);
    const its = await getTodoItems(list.id);
    setItems(its);
  }

  async function handleToggle(item: TodoItem) {
    try {
      const updated = await toggleTodoItem(item.id);
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    } catch {
      Alert.alert('Error', 'Could not update item');
    }
  }

  async function handleDelete(item: TodoItem) {
    Alert.alert('Delete', `Delete "${item.text}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteTodoItem(item.id);
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch {
            Alert.alert('Error', 'Could not delete item');
          }
        },
      },
    ]);
  }

  async function handleAdd() {
    if (!newItem.trim() || !selectedList) return;
    try {
      const item = await addTodoItem(selectedList.id, newItem.trim());
      setItems(prev => [...prev, item]);
      setNewItem('');
    } catch {
      Alert.alert('Error', 'Could not add item');
    }
  }

  const unchecked = items.filter(i => !i.checked);
  const checked = items.filter(i => i.checked);
  const combined = [...unchecked, ...checked];

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

      <FlatList
        data={combined}
        keyExtractor={item => String(item.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadLists} />}
        contentContainerStyle={{ paddingBottom: 80 }}
        renderItem={({ item, index }) => (
          <>
            {index === unchecked.length && checked.length > 0 && unchecked.length > 0 && (
              <Text style={styles.sectionDivider}>Completed</Text>
            )}
            <TouchableOpacity
              style={styles.item}
              onPress={() => handleToggle(item)}
              onLongPress={() => handleDelete(item)}
              activeOpacity={0.6}
            >
              <View style={[styles.check, item.checked && styles.checkDone]}>
                {item.checked && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={[styles.itemText, item.checked && styles.itemDone]}>
                {item.text}
              </Text>
            </TouchableOpacity>
          </>
        )}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={styles.empty}>
              {selectedList ? 'Nothing to do!' : 'No to-do lists found'}
            </Text>
          ) : null
        }
      />

      {selectedList && (
        <View style={styles.addBar}>
          <TextInput
            style={styles.addInput}
            placeholder="Add item…"
            value={newItem}
            onChangeText={setNewItem}
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
  sectionDivider: {
    fontSize: 11, fontWeight: '700', color: '#999',
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
    backgroundColor: '#f5f5f5',
  },
  item: {
    flexDirection: 'row', backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 15,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  check: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#ccc',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  checkDone: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  itemText: { flex: 1, fontSize: 16, color: '#1a1a1a' },
  itemDone: { color: '#c0c0c0', textDecorationLine: 'line-through' },
  empty: { textAlign: 'center', color: '#bbb', marginTop: 80, fontSize: 15 },
  addBar: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#e0e0e0',
    padding: 8, gap: 6,
  },
  addInput: {
    flex: 1, backgroundColor: '#f5f5f5', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  addBtn: {
    backgroundColor: '#4A90D9', borderRadius: 8,
    paddingHorizontal: 16, justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
