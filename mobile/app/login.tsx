import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { login, getServerUrl, getSavedCredentials, saveCredentials } from '../src/api/client';
import { ensureDefaultNotifPrefs } from '../src/notifications';

export default function LoginScreen() {
  const router = useRouter();
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
        placeholderTextColor="#aaa"
      />
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        returnKeyType="next"
        placeholderTextColor="#aaa"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={handleLogin}
        placeholderTextColor="#aaa"
      />
      <View style={styles.rememberRow}>
        <Text style={styles.rememberLabel}>Remember me</Text>
        <Switch
          value={rememberMe}
          onValueChange={setRememberMe}
          trackColor={{ false: '#e0e0e0', true: '#4A90D9' }}
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

const styles = StyleSheet.create({
  container: {
    flex: 1, padding: 28, justifyContent: 'center', backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 34, fontWeight: '700', color: '#4A90D9',
    marginBottom: 36, textAlign: 'center', letterSpacing: -0.5,
  },
  input: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14,
    marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: '#e0e0e0', color: '#222',
  },
  rememberRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 4, marginBottom: 16,
  },
  rememberLabel: { fontSize: 16, color: '#444' },
  button: {
    backgroundColor: '#4A90D9', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
