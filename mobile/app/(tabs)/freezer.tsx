import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, TextInput,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getFreezers, getFreezerItems, addFreezerItem, deleteFreezerItem } from '../../src/api/client';
import type { Freezer, FreezerItem } from '../../src/api/types';
import { useTheme, type Colors } from '../../src/theme';
import { useKeyboardHeight } from '../../src/useKeyboardHeight';

function expiryStatus(dateStr?: string | null): 'expired' | 'expiring-soon' | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(dateStr + 'T00:00:00');
  const days = (exp.getTime() - today.getTime()) / 86400000;
  if (days < 0) return 'expired';
  if (days <= 7) return 'expiring-soon';
  return null;
}

export default function FreezerScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const keyboardHeight = useKeyboardHeight();
  const [freezers, setFreezers] = useState<Freezer[]>([]);
  const [selectedFreezer, setSelectedFreezer] = useState<Freezer | null>(null);
  const [items, setItems] = useState<FreezerItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newDatePurchased, setNewDatePurchased] = useState('');
  const [newExpirationDate, setNewExpirationDate] = useState('');

  useFocusEffect(useCallback(() => { loadFreezers(); }, []));

  async function loadFreezers() {
    setRefreshing(true);
    try {
      const data = await getFreezers();
      setFreezers(data);
      const current = selectedFreezer ? data.find(f => f.id === selectedFreezer.id) : data[0];
      if (current) await loadFreezer(current);
    } catch {
      Alert.alert('Error', 'Could not load freezers');
    } finally {
      setRefreshing(false);
    }
  }

  async function loadFreezer(freezer: Freezer) {
    setSelectedFreezer(freezer);
    const its = await getFreezerItems(freezer.id);
    setItems(its);
  }

  async function handleDelete(item: FreezerItem) {
    Alert.alert('Delete', `Delete "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteFreezerItem(item.id);
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch {
            Alert.alert('Error', 'Could not delete item');
          }
        },
      },
    ]);
  }

  async function handleAdd() {
    if (!newName.trim() || !selectedFreezer) return;
    try {
      const item = await addFreezerItem(
        selectedFreezer.id, newName.trim(), newQuantity.trim(), newDatePurchased.trim(), newExpirationDate.trim(),
      );
      setItems(prev => [...prev, item]);
      setNewName('');
      setNewQuantity('');
      setNewDatePurchased('');
      setNewExpirationDate('');
    } catch {
      Alert.alert('Error', 'Could not add item. Check dates are in YYYY-MM-DD format.');
    }
  }

  return (
    <View style={styles.container}>
      {freezers.length > 0 && (
        <View style={styles.tabs}>
          {freezers.map(freezer => (
            <TouchableOpacity
              key={freezer.id}
              style={[styles.tab, selectedFreezer?.id === freezer.id && styles.tabActive]}
              onPress={() => loadFreezer(freezer)}
            >
              <Text style={[styles.tabText, selectedFreezer?.id === freezer.id && styles.tabTextActive]}>
                {freezer.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={item => String(item.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadFreezers} />}
        contentContainerStyle={{ paddingBottom: 8 }}
        renderItem={({ item }) => {
          const status = expiryStatus(item.expiration_date);
          return (
            <TouchableOpacity
              style={[
                styles.item,
                status === 'expired' && styles.itemExpired,
                status === 'expiring-soon' && styles.itemExpiringSoon,
              ]}
              onLongPress={() => handleDelete(item)}
              activeOpacity={0.6}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.itemText}>
                  {item.name}{item.quantity ? ` (${item.quantity})` : ''}
                </Text>
                {(item.date_purchased || item.expiration_date) && (
                  <Text style={styles.itemMeta}>
                    {item.date_purchased ? `purchased ${item.date_purchased}` : ''}
                    {item.date_purchased && item.expiration_date ? '  ·  ' : ''}
                    {item.expiration_date ? `expires ${item.expiration_date}` : ''}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={styles.empty}>
              {selectedFreezer ? 'Nothing in this freezer' : 'No freezers found'}
            </Text>
          ) : null
        }
      />

      {selectedFreezer && (
        <View style={{ paddingBottom: keyboardHeight }}>
          <View style={styles.addBar}>
            <View style={styles.addRow}>
              <TextInput
                style={[styles.addInput, { flex: 2 }]}
                placeholder="Item…"
                value={newName}
                onChangeText={setNewName}
                placeholderTextColor={colors.placeholder}
              />
              <TextInput
                style={[styles.addInput, { flex: 1 }]}
                placeholder="Qty"
                value={newQuantity}
                onChangeText={setNewQuantity}
                placeholderTextColor={colors.placeholder}
              />
            </View>
            <View style={styles.addRow}>
              <TextInput
                style={[styles.addInput, { flex: 1 }]}
                placeholder="Purchased YYYY-MM-DD"
                value={newDatePurchased}
                onChangeText={setNewDatePurchased}
                keyboardType="numbers-and-punctuation"
                placeholderTextColor={colors.placeholder}
              />
              <TextInput
                style={[styles.addInput, { flex: 1 }]}
                placeholder="Expires YYYY-MM-DD"
                value={newExpirationDate}
                onChangeText={setNewExpirationDate}
                keyboardType="numbers-and-punctuation"
                placeholderTextColor={colors.placeholder}
              />
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
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
    item: {
      flexDirection: 'row', backgroundColor: colors.surface,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      alignItems: 'center',
    },
    itemExpired: { backgroundColor: colors.dangerBg, borderLeftWidth: 3, borderLeftColor: colors.danger },
    itemExpiringSoon: { backgroundColor: colors.warningBg, borderLeftWidth: 3, borderLeftColor: colors.warning },
    itemText: { fontSize: 16, color: colors.text },
    itemMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
    empty: { textAlign: 'center', color: colors.placeholder, marginTop: 80, fontSize: 15 },
    addBar: {
      backgroundColor: colors.surface,
      borderTopWidth: 1, borderTopColor: colors.border,
      padding: 8, gap: 6,
    },
    addRow: { flexDirection: 'row', gap: 6 },
    addInput: {
      backgroundColor: colors.surfaceAlt, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text,
    },
    addBtn: {
      backgroundColor: colors.primary, borderRadius: 8,
      paddingHorizontal: 16, justifyContent: 'center',
    },
    addBtnText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  });
}
