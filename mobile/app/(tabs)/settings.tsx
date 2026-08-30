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
import { loadTimeFormat, setTimeFormat, loadDisplayTimezone, setDisplayTimezone, type TimeFormat } from '../../src/preferences';
import { deviceTimeZone } from '../../src/calendar/dateUtils';
import { COMMON_TIMEZONES } from '../../src/calendar/timezones';
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
  const [displayTz, setDisplayTzState] = useState<string | null>(null);
  const [tzExpanded, setTzExpanded] = useState(false);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const [url, prefs, format, tz] = await Promise.all([
      getServerUrl(), getNotifPrefs(), loadTimeFormat(), loadDisplayTimezone(),
    ]);
    setServerUrlState(url);
    setNotifEvents(prefs.events);
    setNotifGrocery(prefs.grocery);
    setTimeFormatState(format);
    setDisplayTzState(tz);
  }

  async function handleTimeFormatChange(format: TimeFormat) {
    setTimeFormatState(format);
    await setTimeFormat(format);
  }

  async function handleDisplayTzChange(tz: string | null) {
    setDisplayTzState(tz);
    setTzExpanded(false);
    await setDisplayTimezone(tz);
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
          placeholder="https://your-server.example.com"
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

      <Text style={styles.section}>Display Time Zone</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Event times are shown in this zone, even if your phone is somewhere else.
        </Text>
        <TouchableOpacity
          style={[styles.tzPill, !displayTz && styles.tzPillActive]}
          onPress={() => handleDisplayTzChange(null)}
        >
          <Text style={[styles.tzPillText, !displayTz && styles.tzPillTextActive]}>
            Device ({deviceTimeZone()})
          </Text>
        </TouchableOpacity>
        {displayTz && (
          <TouchableOpacity style={[styles.tzPill, styles.tzPillActive]} onPress={() => setTzExpanded(e => !e)}>
            <Text style={[styles.tzPillText, styles.tzPillTextActive]}>{displayTz}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setTzExpanded(e => !e)} style={{ marginTop: 4 }}>
          <Text style={styles.navRowLabel}>{tzExpanded ? 'Hide zone list' : 'Choose a specific zone…'}</Text>
        </TouchableOpacity>
        {tzExpanded && (
          <View style={styles.tzList}>
            {COMMON_TIMEZONES.map(tz => (
              <TouchableOpacity
                key={tz}
                style={[styles.tzPill, displayTz === tz && styles.tzPillActive]}
                onPress={() => handleDisplayTzChange(tz)}
              >
                <Text style={[styles.tzPillText, displayTz === tz && styles.tzPillTextActive]}>{tz}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
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

      <Text style={styles.section}>Family</Text>
      <View style={styles.card}>
        <TouchableOpacity onPress={() => router.push('/members')} style={styles.navRow}>
          <Text style={styles.navRowLabel}>Family Members</Text>
          <Text style={styles.navRowChevron}>›</Text>
        </TouchableOpacity>
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
    tzList: { marginTop: 8, gap: 8 },
    tzPill: {
      borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12,
      backgroundColor: colors.surfaceAlt, marginBottom: 8,
    },
    tzPillActive: { backgroundColor: colors.primary },
    tzPillText: { fontSize: 14, color: colors.text },
    tzPillTextActive: { color: colors.primaryText, fontWeight: '600' },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { fontSize: 16, color: colors.text, marginBottom: 2 },
    rowSub: { fontSize: 12, color: colors.textFaint },
    signOutRow: { paddingVertical: 4 },
    signOut: { color: colors.danger, fontSize: 16, textAlign: 'center', fontWeight: '500' },
    navRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4,
    },
    navRowLabel: { fontSize: 16, color: colors.text },
    navRowChevron: { fontSize: 20, color: colors.textFaint },
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
