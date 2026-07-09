import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Switch, StyleSheet,
  TouchableOpacity, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { getServerUrl, setServerUrl, clearAuth } from '../../src/api/client';
import { getNotifPrefs, setNotifPref, requestNotificationPermission } from '../../src/notifications';

export default function SettingsScreen() {
  const router = useRouter();
  const [serverUrl, setServerUrlState] = useState('');
  const [notifEvents, setNotifEvents] = useState(false);
  const [notifGrocery, setNotifGrocery] = useState(false);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const [url, prefs] = await Promise.all([getServerUrl(), getNotifPrefs()]);
    setServerUrlState(url);
    setNotifEvents(prefs.events);
    setNotifGrocery(prefs.grocery);
  }

  async function saveUrl() {
    if (!serverUrl.trim()) {
      Alert.alert('Error', 'Server URL cannot be empty');
      return;
    }
    await setServerUrl(serverUrl.trim());
    Alert.alert('Saved', 'Server URL updated');
  }

  async function handleNotifToggle(key: 'events' | 'grocery', value: boolean) {
    if (value) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Permission Required',
          'Enable notifications for FamilyHub in your device Settings.',
        );
        return;
      }
    }
    await setNotifPref(key, value);
    if (key === 'events') setNotifEvents(value);
    else setNotifGrocery(value);
  }

  async function handleLogout() {
    Alert.alert('Sign Out', 'Sign out of FamilyHub?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await clearAuth();
          router.replace('/login');
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.section}>Server</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrlState}
          placeholder="https://your-app.railway.app"
          autoCapitalize="none"
          keyboardType="url"
          placeholderTextColor="#bbb"
        />
        <TouchableOpacity style={styles.btn} onPress={saveUrl}>
          <Text style={styles.btnText}>Save URL</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Notifications</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Checks for updates every 15 minutes in the background.
          First notification after enabling initializes the baseline — you'll see
          alerts only for items added after that point.
        </Text>
        <Row
          label="New events"
          sub="Alert when a calendar event is created"
          value={notifEvents}
          onChange={v => handleNotifToggle('events', v)}
        />
        <Row
          label="Grocery items"
          sub="Alert when items are added to any grocery list"
          value={notifGrocery}
          onChange={v => handleNotifToggle('grocery', v)}
          last
        />
      </View>

      <Text style={styles.section}>Account</Text>
      <View style={styles.card}>
        <TouchableOpacity onPress={handleLogout} style={styles.signOutRow}>
          <Text style={styles.signOut}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        Tap to toggle grocery/todo items.{'\n'}
        Long-press to delete.{'\n'}
        Pull down on any screen to refresh.
      </Text>
    </ScrollView>
  );
}

function Row({
  label, sub, value, onChange, last = false,
}: {
  label: string; sub: string; value: boolean;
  onChange: (v: boolean) => void; last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#e0e0e0', true: '#4A90D9' }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  section: {
    fontSize: 12, fontWeight: '700', color: '#999',
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8,
  },
  card: {
    backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  label: { fontSize: 13, color: '#666', marginBottom: 6 },
  input: {
    backgroundColor: '#f5f5f5', borderRadius: 8, padding: 12,
    fontSize: 15, color: '#1a1a1a', marginBottom: 12,
  },
  btn: {
    backgroundColor: '#4A90D9', borderRadius: 8,
    padding: 12, alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
  hint: { fontSize: 13, color: '#999', lineHeight: 18, marginBottom: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 16, color: '#1a1a1a', marginBottom: 2 },
  rowSub: { fontSize: 12, color: '#aaa' },
  signOutRow: { paddingVertical: 4 },
  signOut: { color: '#E74C3C', fontSize: 16, textAlign: 'center', fontWeight: '500' },
  footer: {
    textAlign: 'center', color: '#bbb', fontSize: 12,
    marginTop: 20, paddingHorizontal: 20, lineHeight: 20,
  },
});
