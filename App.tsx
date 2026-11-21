import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LoginScreen } from './src/LoginScreen';
import { User, clearCredentials, getProfile, setCredentials } from './src/api';
import { colors } from './src/theme';

const STORAGE_KEY = 'credentials';

type SavedCredentials = { username: string; password: string };

function parseSaved(raw: string | null): SavedCredentials | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value?.username === 'string' && typeof value?.password === 'string') return value;
  } catch {}
  return null;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<User | null>(null);

  // Verifies the credentials against the server before accepting them.
  const login = useCallback(async (username: string, password: string) => {
    setCredentials(username, password);
    try {
      const profile = await getProfile();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ username, password }));
      setMe(profile);
    } catch (e) {
      clearCredentials();
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    clearCredentials();
    setMe(null);
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  // Restore the previous session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const saved = parseSaved(raw);
        if (saved) {
          await login(saved.username, saved.password);
        } else if (raw) {
          await AsyncStorage.removeItem(STORAGE_KEY); // corrupted entry
        }
      } catch {
        // Server unreachable or credentials rejected: fall through to the login screen.
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [login]);

  let screen;
  if (booting) {
    screen = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.header} />
      </View>
    );
  } else if (!me) {
    screen = <LoginScreen onLogin={login} />;
  } else {
    // Temporary home screen; replaced by the chat list in the next commit.
    screen = (
      <SafeAreaView style={styles.center}>
        <Text style={styles.hello}>Logged in as {me.name}</Text>
        <Pressable style={styles.button} onPress={logout}>
          <Text style={styles.buttonText}>Logout</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {screen}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  hello: { fontSize: 18, color: colors.text, marginBottom: 16 },
  button: { backgroundColor: colors.header, borderRadius: 24, paddingVertical: 10, paddingHorizontal: 24 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
