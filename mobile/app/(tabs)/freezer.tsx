import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, TextInput,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getFreezers, getFreezerItems, addFreezerItem, deleteFreezerItem,
  incrementFreezerItem, decrementFreezerItem,
} from '../../src/api/client';
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
  const [newQuantityUnit, setNewQuantityUnit] = useState<'' | 'oz' | 'lb'>('');
  const [newCount, setNewCount] = useState('1');
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
        selectedFreezer.id, newName.trim(), newQuantity.trim(), newQuantityUnit || null,
        newDatePurchased.trim(), newExpirationDate.trim(),
        Math.max(1, parseInt(newCount, 10) || 1),
      );
      setItems(prev => [...prev, item]);
      setNewName('');
      setNewQuantity('');
      setNewQuantityUnit('');
      setNewCount('1');
      setNewDatePurchased('');
      setNewExpirationDate('');
    } catch {
      Alert.alert('Error', 'Could not add item. Check dates are in YYYY-MM-DD format.');
    }
  }

  async function handleIncrement(item: FreezerItem) {
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, count: i.count + 1 } : i)));
    try {
      const updated = await incrementFreezerItem(item.id);
      setItems(prev => prev.map(i => (i.id === item.id ? updated : i)));
    } catch {
      setItems(prev => prev.map(i => (i.id === item.id ? item : i)));
      Alert.alert('Error', 'Could not update count');
    }
  }

  async function handleDecrement(item: FreezerItem) {
    if (item.count <= 1) {
      Alert.alert('Remove item', `Remove "${item.name}" from the freezer?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            try {
              await decrementFreezerItem(item.id);
              setItems(prev => prev.filter(i => i.id !== item.id));
            } catch {
              Alert.alert('Error', 'Could not update count');
            }
          },
        },
      ]);
      return;
    }
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, count: i.count - 1 } : i)));
    try {
      const updated = await decrementFreezerItem(item.id);
      if (!updated.deleted) {
        setItems(prev => prev.map(i => (i.id === item.id ? (updated as FreezerItem) : i)));
      }
    } catch {
      setItems(prev => prev.map(i => (i.id === item.id ? item : i)));
      Alert.alert('Error', 'Could not update count');
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
                  {item.name}{item.quantity ? ` (${item.quantity}${item.quantity_unit ? ` ${item.quantity_unit}` : ''})` : ''}
                </Text>
                {(item.date_purchased || item.expiration_date) && (
                  <Text style={styles.itemMeta}>
                    {item.date_purchased ? `purchased ${item.date_purchased}` : ''}
                    {item.date_purchased && item.expiration_date ? '  ·  ' : ''}
                    {item.expiration_date ? `expires ${item.expiration_date}` : ''}
                  </Text>
                )}
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => handleDecrement(item)}>
                  <Text style={styles.stepperBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepperCount}>{item.count}</Text>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => handleIncrement(item)}>
                  <Text style={styles.stepperBtnText}>+</Text>
                </TouchableOpacity>
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
              <View style={styles.unitToggle}>
                {(['oz', 'lb'] as const).map(unit => (
                  <TouchableOpacity
                    key={unit}
                    style={[styles.unitOption, newQuantityUnit === unit && styles.unitOptionActive]}
                    onPress={() => setNewQuantityUnit(prev => (prev === unit ? '' : unit))}
                  >
                    <Text style={[styles.unitOptionText, newQuantityUnit === unit && styles.unitOptionTextActive]}>
                      {unit}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.addInput, { flex: 0.7 }]}
                placeholder="Count"
                value={newCount}
                onChangeText={setNewCount}
                keyboardType="number-pad"
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
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
    stepperBtn: {
      width: 28, height: 28, borderRadius: 6, backgroundColor: colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    stepperBtnText: { fontSize: 17, fontWeight: '700', color: colors.text, lineHeight: 20 },
    stepperCount: { fontSize: 15, fontWeight: '700', color: colors.text, minWidth: 18, textAlign: 'center' },
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
    unitToggle: {
      flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 8, overflow: 'hidden',
    },
    unitOption: { paddingHorizontal: 10, paddingVertical: 10, justifyContent: 'center' },
    unitOptionActive: { backgroundColor: colors.primary },
    unitOptionText: { fontSize: 13, color: colors.textFaint, fontWeight: '600' },
    unitOptionTextActive: { color: colors.primaryText },
  });
}
