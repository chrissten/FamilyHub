import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, Modal, RefreshControl,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { getUsers, getCurrentUserId, updateUserColor } from '../src/api/client';
import type { User } from '../src/api/types';
import { MEMBER_COLOR_PALETTE } from '../src/colorPalette';
import { useTheme, type Colors } from '../src/theme';

export default function MembersScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [members, setMembers] = useState<User[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setRefreshing(true);
    try {
      const [users, myId] = await Promise.all([getUsers(), getCurrentUserId()]);
      setMembers(users);
      setIsAdmin(users.some(u => u.id === myId && u.is_admin));
    } catch {
      Alert.alert('Error', 'Could not load family members');
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePickColor(colorHex: string) {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await updateUserColor(editing.id, colorHex);
      setMembers(prev => prev.map(m => (m.id === updated.id ? updated : m)));
      setEditing(null);
    } catch {
      Alert.alert('Error', 'Could not update color');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Family Members',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
      <FlatList
        data={members}
        keyExtractor={m => String(m.id)}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            disabled={!isAdmin}
            onPress={() => setEditing(item)}
            activeOpacity={isAdmin ? 0.6 : 1}
          >
            <View style={[styles.swatch, { backgroundColor: item.color_hex }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.display_name}</Text>
              <Text style={styles.username}>@{item.username}{item.is_admin ? ' · admin' : ''}</Text>
            </View>
            {isAdmin && <Text style={styles.editHint}>Change</Text>}
          </TouchableOpacity>
        )}
        ListEmptyComponent={!refreshing ? <Text style={styles.empty}>No family members found</Text> : null}
      />

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setEditing(null)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>
              {editing ? `${editing.display_name}'s color` : ''}
            </Text>
            <View style={styles.palette}>
              {MEMBER_COLOR_PALETTE.map(hex => (
                <TouchableOpacity
                  key={hex}
                  style={[
                    styles.paletteSwatch,
                    { backgroundColor: hex },
                    editing?.color_hex.toLowerCase() === hex.toLowerCase() && styles.paletteSwatchSelected,
                  ]}
                  disabled={saving}
                  onPress={() => handlePickColor(hex)}
                />
              ))}
            </View>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
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
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.surface, borderRadius: 10,
      padding: 14, marginBottom: 8,
    },
    swatch: { width: 24, height: 24, borderRadius: 12 },
    name: { fontSize: 16, fontWeight: '600', color: colors.text },
    username: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
    editHint: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    empty: { textAlign: 'center', color: colors.placeholder, marginTop: 60, fontSize: 15 },
    overlay: {
      flex: 1, backgroundColor: colors.overlay,
      justifyContent: 'center', alignItems: 'center', padding: 24,
    },
    sheet: {
      backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 360,
    },
    sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 16, textAlign: 'center' },
    palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
    paletteSwatch: { width: 40, height: 40, borderRadius: 20 },
    paletteSwatchSelected: { borderWidth: 3, borderColor: colors.text },
    cancelBtn: { marginTop: 20, alignItems: 'center', paddingVertical: 8 },
    cancelBtnText: { color: colors.textFaint, fontSize: 15, fontWeight: '600' },
  });
}
