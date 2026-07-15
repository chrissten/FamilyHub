import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, Switch, StyleSheet,
  TouchableOpacity, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { getServerUrl, setServerUrl, clearAuth } from '../../src/api/client';
import { getNotifPrefs, setNotifPref, requestNotificationPermission } from '../../src/notifications';
import { loadTimeFormat, setTimeFormat, type TimeFormat } from '../../src/preferences';
import { useTheme, setThemeMode, type ThemeMode, type Colors } from '../../src/theme';

const appVersion = Constants.expoConfig?.version;
const buildNumber = Constants.expoConfig?.android?.versionCode;

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, mode: themeMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [serverUrl, setServerUrlState] = useState('');
  const [notifEvents, setNotifEvents] = useState(false);
  const [notifGrocery, setNotifGrocery] = useState(false);
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>('12h');

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const [url, prefs, format] = await Promise.all([getServerUrl(), getNotifPrefs(), loadTimeFormat()]);
    setServerUrlState(url);
    setNotifEvents(prefs.events);
    setNotifGrocery(prefs.grocery);
    setTimeFormatState(format);
  }

  async function handleTimeFormatChange(format: TimeFormat) {
    setTimeFormatState(format);
    await setTimeFormat(format);
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
          placeholderTextColor={colors.placeholder}
        />
        <TouchableOpacity style={styles.btn} onPress={saveUrl}>
          <Text style={styles.btnText}>Save URL</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Appearance</Text>
      <View style={styles.card}>
        <View style={styles.segmented}>
          {THEME_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segment, themeMode === opt.key && styles.segmentActive]}
              onPress={() => setThemeMode(opt.key)}
            >
              <Text style={[styles.segmentText, themeMode === opt.key && styles.segmentTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={styles.section}>Time Format</Text>
      <View style={styles.card}>
        <View style={styles.segmented}>
          <TouchableOpacity
            style={[styles.segment, timeFormat === '12h' && styles.segmentActive]}
            onPress={() => handleTimeFormatChange('12h')}
          >
            <Text style={[styles.segmentText, timeFormat === '12h' && styles.segmentTextActive]}>12-hour (AM/PM)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, timeFormat === '24h' && styles.segmentActive]}
            onPress={() => handleTimeFormatChange('24h')}
          >
            <Text style={[styles.segmentText, timeFormat === '24h' && styles.segmentTextActive]}>24-hour</Text>
          </TouchableOpacity>
        </View>
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
          styles={styles}
          colors={colors}
        />
        <Row
          label="Grocery items"
          sub="Alert when items are added to any grocery list"
          value={notifGrocery}
          onChange={v => handleNotifToggle('grocery', v)}
          styles={styles}
          colors={colors}
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
      {!!appVersion && (
        <Text style={styles.version}>
          FamilyHub v{appVersion}{buildNumber != null ? ` (${buildNumber})` : ''}
        </Text>
      )}
    </ScrollView>
  );
}

function Row({
  label, sub, value, onChange, styles, colors, last = false,
}: {
  label: string; sub: string; value: boolean;
  onChange: (v: boolean) => void; styles: ReturnType<typeof createStyles>; colors: Colors; last?: boolean;
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
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    section: {
      fontSize: 12, fontWeight: '700', color: colors.textFaint,
      textTransform: 'uppercase', letterSpacing: 0.8,
      paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8,
    },
    card: {
      backgroundColor: colors.surface, marginHorizontal: 12, borderRadius: 12, padding: 16,
      shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    },
    label: { fontSize: 13, color: colors.textMuted, marginBottom: 6 },
    input: {
      backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: 12,
      fontSize: 15, color: colors.text, marginBottom: 12,
    },
    btn: {
      backgroundColor: colors.primary, borderRadius: 8,
      padding: 12, alignItems: 'center',
    },
    btnText: { color: colors.primaryText, fontWeight: '700' },
    segmented: {
      flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: 3,
    },
    segment: { flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
    segmentTextActive: { color: colors.primaryText },
    hint: { fontSize: 13, color: colors.textFaint, lineHeight: 18, marginBottom: 14 },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { fontSize: 16, color: colors.text, marginBottom: 2 },
    rowSub: { fontSize: 12, color: colors.textFaint },
    signOutRow: { paddingVertical: 4 },
    signOut: { color: colors.danger, fontSize: 16, textAlign: 'center', fontWeight: '500' },
    footer: {
      textAlign: 'center', color: colors.placeholder, fontSize: 12,
      marginTop: 20, paddingHorizontal: 20, lineHeight: 20,
    },
    version: {
      textAlign: 'center', color: colors.textFaint, fontSize: 11,
      marginTop: 12, marginBottom: 4,
    },
  });
}
