import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Switch, BackHandler } from 'react-native';
import { useRouter } from 'expo-router';
import * as IntentLauncher from 'expo-intent-launcher';
import { getServerUrl, getSavedCredentials, useTheme, type Colors } from '../src/shared';
import { setAdminPin, setToggle, useToggle, PIN_PATTERN } from '../src/settings';
import { isKioskPaused, isPinned, pauseKiosk, resumeKiosk } from '../src/kiosk';
import { checkForUpdate, installUpdate, installedVersion, useUpdateState } from '../src/updater';

/** Reached only through the PIN prompt on the hub's rail. */
export default function AdminScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const kioskEnabled = useToggle('kiosk_enabled');
  const keepAwake = useToggle('keep_awake');
  const update = useUpdateState();
  const [pinned, setPinned] = useState(isPinned());
  const [paused, setPaused] = useState(isKioskPaused());
  const [account, setAccount] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getServerUrl(), getSavedCredentials()]).then(([url, creds]) => {
      setAccount(`${creds?.username ?? '?'} @ ${url}`);
    });
  }, []);

  function refreshKiosk() {
    setPinned(isPinned());
    setPaused(isKioskPaused());
  }

  async function unlockAndLeave() {
    await pauseKiosk();
    BackHandler.exitApp();
  }

  // The way out to the rest of the tablet, e.g. to change the default Home app.
  async function openAndroidSettings() {
    await pauseKiosk();
    refreshKiosk();
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.SETTINGS);
  }

  async function changePin() {
    if (!PIN_PATTERN.test(newPin)) return setPinMsg('The PIN must be 4 to 8 digits.');
    await setAdminPin(newPin);
    setNewPin('');
    setPinMsg('PIN changed.');
  }

  const { version, versionCode } = installedVersion();
  const updateText =
    update.kind === 'checking' ? 'Checking…'
    : update.kind === 'downloading' ? `Downloading ${update.manifest.version}…`
    : update.kind === 'ready' ? `Version ${update.manifest.version} is ready to install.`
    : update.kind === 'current' ? `Up to date (checked ${update.checkedAt.toLocaleTimeString()}).`
    : update.kind === 'error' ? `Update check failed: ${update.message}`
    : 'Not checked yet.';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tablet settings</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.columns} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <Section title="Kiosk lock" styles={styles}>
            <Text style={styles.body}>
              {pinned ? 'The app is pinned: Home and Recents are blocked.' : 'The app is not pinned right now.'}
              {paused ? ' Paused until the app restarts.' : ''}
            </Text>
            <Row label="Lock when the app starts" styles={styles}>
              <Switch value={kioskEnabled} onValueChange={v => setToggle('kiosk_enabled', v)} />
            </Row>
            <View style={styles.btnRow}>
              <Btn label="Pin now" onPress={async () => { await resumeKiosk(); refreshKiosk(); }} styles={styles} />
              <Btn label="Unpin" onPress={async () => { await pauseKiosk(); refreshKiosk(); }} styles={styles} />
              <Btn label="Open Android settings" onPress={openAndroidSettings} styles={styles} />
              <Btn label="Unpin and leave app" danger onPress={unlockAndLeave} styles={styles} />
            </View>
          </Section>

          <Section title="Display" styles={styles}>
            <Row label="Keep the screen on" styles={styles}>
              <Switch value={keepAwake} onValueChange={v => setToggle('keep_awake', v)} />
            </Row>
          </Section>
        </View>

        <View style={styles.column}>
          <Section title="Updates" styles={styles}>
            <Text style={styles.body}>Installed: {version} (build {versionCode})</Text>
            <Text style={styles.body}>{updateText}</Text>
            <View style={styles.btnRow}>
              <Btn label="Check now" onPress={checkForUpdate} styles={styles} />
              {update.kind === 'ready' && <Btn label={`Install ${update.manifest.version}`} primary onPress={installUpdate} styles={styles} />}
            </View>
          </Section>

          <Section title="Account" styles={styles}>
            <Text style={styles.body}>{account}</Text>
            <View style={styles.btnRow}>
              <Btn label="Change account" onPress={() => router.push('/setup')} styles={styles} />
            </View>
          </Section>

          <Section title="Grown-ups PIN" styles={styles}>
            <View style={styles.btnRow}>
              <TextInput
                style={styles.input} value={newPin} onChangeText={t => { setNewPin(t); setPinMsg(null); }}
                placeholder="New PIN" placeholderTextColor={colors.placeholder}
                keyboardType="number-pad" secureTextEntry maxLength={8}
              />
              <Btn label="Change PIN" onPress={changePin} styles={styles} />
            </View>
            {pinMsg && <Text style={styles.body}>{pinMsg}</Text>}
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function Section({ title, children, styles }: { title: string; children: ReactNode; styles: Styles }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, children, styles }: { label: string; children: ReactNode; styles: Styles }) {
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{label}</Text>
      {children}
    </View>
  );
}

function Btn({ label, onPress, primary, danger, styles }: {
  label: string; onPress: () => void; primary?: boolean; danger?: boolean; styles: Styles;
}) {
  return (
    <TouchableOpacity style={[styles.btn, primary && styles.btnPrimary, danger && styles.btnDanger]} onPress={onPress}>
      <Text style={[styles.btnText, (primary || danger) && styles.btnTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 24, paddingVertical: 14, backgroundColor: colors.surface,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    title: { fontSize: 26, fontWeight: '700', color: colors.text },
    columns: { flexDirection: 'row', gap: 20, padding: 20 },
    column: { flex: 1, gap: 20 },
    section: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, gap: 10 },
    sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
    body: { fontSize: 16, color: colors.textMuted, flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
    btn: {
      paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
    btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
    btnText: { fontSize: 16, fontWeight: '600', color: colors.text },
    btnTextOn: { color: '#fff' },
    primaryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary },
    primaryBtnText: { color: colors.primaryText, fontSize: 17, fontWeight: '700' },
    input: {
      fontSize: 17, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 10, minWidth: 160,
    },
  });
}
