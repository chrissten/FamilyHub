import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { login, getServerUrl, getSavedCredentials, saveCredentials } from '../src/api/client';
import { ensureDefaultNotifPrefs } from '../src/notifications';
import { useTheme, type Colors } from '../src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([getServerUrl(), getSavedCredentials()]).then(([url, creds]) => {
      setServerUrl(url);
      if (creds) {
        setUsername(creds.username);
        setPassword(creds.password);
        setRememberMe(true);
      }
    });
  }, []);

  async function handleLogin() {
    if (!serverUrl.trim() || !username.trim() || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await login(serverUrl.trim(), username.trim(), password);
      if (rememberMe) {
        await saveCredentials(username.trim(), password);
      }
      await ensureDefaultNotifPrefs();
      router.replace('/(tabs)');
    } catch {
      Alert.alert('Login Failed', 'Check your server URL and credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>FamilyHub</Text>
      <TextInput
        style={styles.input}
        placeholder="Server URL (e.g. https://your-app.railway.app)"
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        keyboardType="url"
        returnKeyType="next"
        placeholderTextColor={colors.placeholder}
      />
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        returnKeyType="next"
        placeholderTextColor={colors.placeholder}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={handleLogin}
        placeholderTextColor={colors.placeholder}
      />
      <View style={styles.rememberRow}>
        <Text style={styles.rememberLabel}>Remember me</Text>
        <Switch
          value={rememberMe}
          onValueChange={setRememberMe}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      </View>
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Sign In</Text>
        }
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1, padding: 28, justifyContent: 'center', backgroundColor: colors.background,
    },
    title: {
      fontSize: 34, fontWeight: '700', color: colors.primary,
      marginBottom: 36, textAlign: 'center', letterSpacing: -0.5,
    },
    input: {
      backgroundColor: colors.surface, borderRadius: 10, padding: 14,
      marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: colors.border, color: colors.text,
    },
    rememberRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 4, marginBottom: 16,
    },
    rememberLabel: { fontSize: 16, color: colors.textMuted },
    button: {
      backgroundColor: colors.primary, borderRadius: 10, padding: 16,
      alignItems: 'center', marginTop: 8,
    },
    buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  });
}
