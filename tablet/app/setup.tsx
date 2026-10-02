import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { login, getServerUrl, getSavedCredentials, saveCredentials, useTheme, type Colors } from '../src/shared';
import { hasAdminPin, setAdminPin, PIN_PATTERN } from '../src/settings';

/** First-run setup (and "change account" from the admin screen): which FamilyHub server
 *  and account the tablet uses, plus the grown-ups PIN on the very first run. The login
 *  is always remembered — there's nobody to retype it on a wall tablet. */
export default function SetupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getServerUrl(), getSavedCredentials(), hasAdminPin()]).then(([url, creds, hasPin]) => {
      setServerUrl(url);
      if (creds) setUsername(creds.username);
      setNeedsPin(!hasPin);
    });
  }, []);

  async function submit() {
    setError(null);
    if (!serverUrl.trim() || !username.trim() || !password) return setError('Fill in the server, username and password.');
    if (needsPin) {
      if (!PIN_PATTERN.test(pin)) return setError('The PIN must be 4 to 8 digits.');
      if (pin !== pin2) return setError('The two PINs don’t match.');
    }
    setBusy(true);
    try {
      await login(serverUrl.trim(), username.trim(), password);
      await saveCredentials(username.trim(), password);
      if (needsPin) await setAdminPin(pin);
      router.replace('/calendar');
    } catch {
      setError('Could not sign in. Check the server address and account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Set up FamilyHub Tablet</Text>
        <Text style={styles.hint}>
          Use a family account. Anything added from the tablet (like grocery items) will show as added by it.
        </Text>
        <TextInput style={styles.input} placeholder="Server URL (https://...)" placeholderTextColor={colors.placeholder}
          value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" keyboardType="url" />
        <TextInput style={styles.input} placeholder="Username" placeholderTextColor={colors.placeholder}
          value={username} onChangeText={setUsername} autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.placeholder}
          value={password} onChangeText={setPassword} secureTextEntry />
        {needsPin && (
          <>
            <Text style={styles.section}>Grown-ups PIN</Text>
            <Text style={styles.hint}>Needed to open settings, unlock the tablet or install updates.</Text>
            <View style={styles.pinRow}>
              <TextInput style={[styles.input, styles.pinInput]} placeholder="PIN (4-8 digits)" placeholderTextColor={colors.placeholder}
                value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={8} />
              <TextInput style={[styles.input, styles.pinInput]} placeholder="PIN again" placeholderTextColor={colors.placeholder}
                value={pin2} onChangeText={setPin2} keyboardType="number-pad" secureTextEntry maxLength={8} />
            </View>
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.buttonText}>Save and start</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.background },
    card: { width: 620, backgroundColor: colors.surface, borderRadius: 20, padding: 32 },
    title: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 8 },
    section: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 18 },
    hint: { fontSize: 15, color: colors.textMuted, marginBottom: 12 },
    input: {
      fontSize: 18, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: 12,
      paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12,
    },
    pinRow: { flexDirection: 'row', gap: 12 },
    pinInput: { flex: 1 },
    error: { fontSize: 16, color: colors.danger, marginBottom: 8 },
    button: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    buttonText: { color: colors.primaryText, fontSize: 19, fontWeight: '700' },
  });
}
