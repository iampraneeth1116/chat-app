import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
} from 'react-native';
import { colors } from './theme';

type Props = { onLogin: (username: string, password: string) => Promise<void> };

export function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const passwordRef = useRef<TextInputInstance>(null);

  const canSubmit = !!username.trim() && !!password && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    try {
      await onLogin(username.trim(), password);
      // On success the parent swaps this screen out, so no state updates here.
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed');
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Welcome to Chat</Text>
      <Text style={styles.sub}>Enter a username and password. New usernames are registered automatically.</Text>
      <TextInput
        style={styles.input}
        placeholder="Username"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        returnKeyType="next"
        editable={!loading}
        value={username}
        onChangeText={setUsername}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextInput
        ref={passwordRef}
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        returnKeyType="go"
        editable={!loading}
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.button, !canSubmit && styles.buttonDisabled]} onPress={submit} disabled={!canSubmit}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>NEXT</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 32 },
  title: { fontSize: 22, fontWeight: '600', color: colors.header, textAlign: 'center' },
  sub: { color: colors.subtext, textAlign: 'center', marginVertical: 16 },
  input: { borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: 10, fontSize: 17, marginBottom: 20 },
  error: { color: colors.error, textAlign: 'center', marginBottom: 12 },
  button: { backgroundColor: colors.accent, borderRadius: 24, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700', letterSpacing: 1 },
});
