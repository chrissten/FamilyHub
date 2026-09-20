import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, SectionList, StyleSheet, TextInput, TouchableOpacity, Alert,
  RefreshControl,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getPantryItems, addPantryItem, updatePantryItem, deletePantryItem,
} from '../src/api/client';
import type { PantryItem } from '../src/api/types';
import { useTheme, type Colors } from '../src/theme';
import { useKeyboardHeight } from '../src/useKeyboardHeight';

type Location = 'pantry' | 'fridge';
const LOCATIONS: Location[] = ['pantry', 'fridge'];
const TITLES: Record<Location, string> = { pantry: 'Cupboard', fridge: 'Fridge' };

export default function PantryScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const keyboardHeight = useKeyboardHeight();
  const router = useRouter();

  const [items, setItems] = useState<PantryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<Record<Location, string>>({ pantry: '', fridge: '' });

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setRefreshing(true);
    try {
      setItems(await getPantryItems());
    } catch {
      Alert.alert('Error', 'Could not load the pantry');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAdd(location: Location) {
    const name = drafts[location].trim();
    if (!name) return;
    setDrafts(prev => ({ ...prev, [location]: '' }));
    try {
      const item = await addPantryItem(name, location);
      // The server dedupes by canonical ingredient + location, so re-adding something
      // returns the existing row rather than a second one.
      setItems(prev => (prev.some(i => i.id === item.id) ? prev.map(i => (i.id === item.id ? item : i)) : [...prev, item]));
    } catch {
      Alert.alert('Error', `Could not add ${name}`);
    }
  }

  async function toggleLow(item: PantryItem) {
    // Optimistic: this is a one-bit toggle people tap while looking in a cupboard.
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, low: !i.low } : i)));
    try {
      const updated = await updatePantryItem(item.id, { low: !item.low });
      setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    } catch {
      setItems(prev => prev.map(i => (i.id === item.id ? item : i)));
      Alert.alert('Error', 'Could not update that');
    }
  }

  function confirmDelete(item: PantryItem) {
    Alert.alert('Remove from pantry', `Remove ${item.ingredient.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePantryItem(item.id);
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch {
            Alert.alert('Error', 'Could not remove that');
          }
        },
      },
    ]);
  }

  const sections = LOCATIONS.map(location => ({
    location,
    title: TITLES[location],
    data: items.filter(i => i.location === location),
  }));
  const lowCount = items.filter(i => i.low).length;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Pantry',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/cook-now')} hitSlop={8}>
              <Ionicons name="restaurant-outline" size={22} color="#fff" />
            </TouchableOpacity>
          ),
        }}
      />

      {lowCount > 0 && (
        <Text style={styles.lowBanner}>
          {lowCount} item{lowCount === 1 ? '' : 's'} running low — add them from the Grocery tab or the web app.
        </Text>
      )}

      <SectionList
        sections={sections}
        keyExtractor={item => String(item.id)}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} colors={[colors.primary]} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: 60 + keyboardHeight }}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeaderWrap}>
            <Text style={styles.sectionHeader}>{section.title}</Text>
          </View>
        )}
        renderSectionFooter={({ section }) => (
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={drafts[section.location as Location]}
              onChangeText={text => setDrafts(prev => ({ ...prev, [section.location]: text }))}
              onSubmitEditing={() => handleAdd(section.location as Location)}
              returnKeyType="done"
              placeholder={`Add to ${section.title.toLowerCase()}`}
              placeholderTextColor={colors.placeholder}
            />
            <TouchableOpacity style={styles.addButton} onPress={() => handleAdd(section.location as Location)}>
              <Ionicons name="add" size={20} color={colors.primaryText} />
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onLongPress={() => confirmDelete(item)}>
            <View style={styles.rowMain}>
              <Text style={[styles.rowName, item.low && styles.rowLow]}>{item.ingredient.name}</Text>
              <View style={styles.rowMeta}>
                {!!item.quantity && <Text style={styles.rowQty}>{item.quantity}</Text>}
                {!!item.ingredient.category && <Text style={styles.categoryChip}>{item.ingredient.category}</Text>}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.lowButton, item.low && styles.lowButtonActive]}
              onPress={() => toggleLow(item)}
            >
              <Text style={[styles.lowText, item.low && styles.lowTextActive]}>{item.low ? 'Low' : 'Low?'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nothing in the pantry yet. Add what's in the cupboard and fridge, and "What can
            I cook?" starts working.
          </Text>
        }
        ListFooterComponent={
          <Text style={styles.hint}>
            Long-press an item to remove it. Staples and the freezer are counted
            automatically — you don't need to list salt or what's already frozen.
          </Text>
        }
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    lowBanner: {
      backgroundColor: colors.warningBg, color: colors.warning,
      paddingHorizontal: 14, paddingVertical: 9, fontSize: 12.5,
    },
    sectionHeaderWrap: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 6 },
    sectionHeader: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: 0.8, color: colors.textFaint,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    rowMain: { flex: 1 },
    rowName: { fontSize: 15, color: colors.text },
    rowLow: { color: colors.warning, fontWeight: '600' },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
    rowQty: { fontSize: 12, color: colors.textFaint },
    categoryChip: {
      fontSize: 10.5, color: colors.chipText, backgroundColor: colors.chip,
      paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, overflow: 'hidden',
    },
    lowButton: { backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
    lowButtonActive: { backgroundColor: colors.warning },
    lowText: { fontSize: 11.5, color: colors.textMuted, fontWeight: '600' },
    lowTextActive: { color: '#fff' },
    addRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
    addInput: {
      flex: 1, backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1,
      borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8,
      fontSize: 14.5, color: colors.text,
    },
    addButton: {
      backgroundColor: colors.primary, borderRadius: 8, width: 38,
      alignItems: 'center', justifyContent: 'center',
    },
    empty: { color: colors.textMuted, fontSize: 14.5, textAlign: 'center', padding: 24, lineHeight: 21 },
    hint: { color: colors.textFaint, fontSize: 12, padding: 16, lineHeight: 17, textAlign: 'center' },
  });
}
