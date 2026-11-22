import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatListScreen } from './src/ChatListScreen';
import { ChatScreen } from './src/ChatScreen';
import { LoginScreen } from './src/LoginScreen';
import { SignupScreen } from './src/SignupScreen';
import { User, clearCredentials, getProfile, loginUser, setCredentials, signupUser } from './src/api';
import { colors } from './src/theme';

const STORAGE_KEY = 'credentials';

type SavedCredentials = { username: string; password: string };
type AuthMode = 'login' | 'signup';

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
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);

  const persistSession = useCallback(async (username: string, password: string, profile: User) => {
    setCredentials(username, password);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ username, password }));
    setMe(profile);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const profile = await loginUser(username, password);
      await persistSession(username, password, profile);
    },
    [persistSession],
  );

  const signup = useCallback(
    async (username: string, password: string, bio?: string) => {
      const profile = await signupUser(username, password, bio);
      await persistSession(username, password, profile);
    },
    [persistSession],
  );

  const logout = useCallback(async () => {
    clearCredentials();
    setOpen(null);
    setMe(null);
    setAuthMode('login');
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
          setCredentials(saved.username, saved.password);
          const profile = await getProfile();
          if (!cancelled) setMe(profile);
        } else if (raw) {
          await AsyncStorage.removeItem(STORAGE_KEY); // corrupted entry
        }
      } catch {
        clearCredentials();
        // Server unreachable or credentials rejected: fall through to the login screen.
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // On Android, pressing the hardware back button inside a chat returns to the chat list.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  let screen;
  if (booting) {
    screen = (
      <View style={styles.center}>
        <View style={styles.bootLogo}>
          <Ionicons name="chatbubble-ellipses" size={26} color="#FFFFFF" />
        </View>
        <ActivityIndicator size="small" color={colors.brand} />
      </View>
    );
  } else if (!me) {
    screen =
      authMode === 'login' ? (
        <LoginScreen onLogin={login} onSwitchToSignup={() => setAuthMode('signup')} />
      ) : (
        <SignupScreen onSignup={signup} onSwitchToLogin={() => setAuthMode('login')} />
      );
  } else if (open) {
    screen = (
      <ChatScreen
        key={open.id}
        conversationId={open.id}
        title={open.title}
        meId={me.id}
        onBack={() => setOpen(null)}
      />
    );
  } else {
    screen = <ChatListScreen me={me} onOpen={(c, title) => setOpen({ id: c.id, title })} onLogout={logout} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {screen}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: 16 },
  bootLogo: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
