import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { Message, getMessages, sendMessage } from './api';
import { colors, formatTime } from './theme';

const POLL_MS = 3000;

type Props = { conversationId: string; title: string; meId: string; onBack: () => void };

/**
 * Merges two message lists by id (newer copies win, so read receipts update)
 * and returns them newest first, which is what the inverted list expects.
 */
function mergeMessages(current: Message[], incoming: Message[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  });
}

function Ticks({ m, meId }: { m: Message; meId: string }) {
  const others = Object.entries(m.status ?? {}).filter(([id]) => id !== meId);
  const read = others.length > 0 && others.every(([, s]) => s.read);
  const delivered = others.length > 0 && others.every(([, s]) => s.delivered || s.read);
  return <Text style={[styles.tick, read && { color: colors.tick }]}>{delivered ? '✓✓' : '✓'}</Text>;
}

export function ChatScreen({ conversationId, title, meId, onBack }: Props) {
  // Newest first, rendered in an inverted list.
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const cursor = useRef<string | null>(null); // points at the next older page
  const reachedStart = useRef(false); // true once the oldest message has been loaded
  const loadingOlder = useRef(false);
  const polling = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Fetch the newest page and merge it in. Runs on open and then on an interval.
  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const page = await getMessages(conversationId);
      if (!mounted.current) return;
      setMessages((prev) => mergeMessages(prev, page.data));
      // Pick up the cursor the first time one exists (also covers chats that were empty when opened).
      if (!cursor.current && !reachedStart.current) cursor.current = page.nextCursor ?? null;
    } catch {
      // Transient network errors: the next poll will retry.
    } finally {
      polling.current = false;
    }
  }, [conversationId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const loadOlder = async () => {
    if (!cursor.current || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const page = await getMessages(conversationId, cursor.current);
      if (!mounted.current) return;
      setMessages((prev) => mergeMessages(prev, page.data));
      cursor.current = page.nextCursor ?? null;
      if (!cursor.current) reachedStart.current = true;
    } catch {
      // Will retry the next time the end of the list is reached.
    } finally {
      loadingOlder.current = false;
    }
  };

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText('');
    try {
      const m = await sendMessage(conversationId, content);
      if (mounted.current) setMessages((prev) => mergeMessages(prev, [m]));
    } catch (e: unknown) {
      if (!mounted.current) return;
      setText(content);
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const canSend = !!text.trim() && !sending;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Avatar name={title} size={38} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const mine = item.senderId === meId;
            return (
              <View style={[styles.bubble, mine ? styles.out : styles.in]}>
                {item.type === 'IMAGE' && <Text style={styles.msg}>📷 Photo</Text>}
                {item.type === 'FILE' && <Text style={styles.msg}>📎 {item.file?.name ?? 'File'}</Text>}
                {!!item.content && <Text style={styles.msg}>{item.content}</Text>}
                <View style={styles.meta}>
                  <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                  {mine && <Ticks m={item} meId={meId} />}
                </View>
              </View>
            );
          }}
        />
        <View style={styles.inputRow}>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder="Message"
              value={text}
              onChangeText={setText}
              multiline
            />
          </View>
          <Pressable style={[styles.send, !canSend && styles.sendDisabled]} onPress={send} disabled={!canSend}>
            <Text style={styles.sendText}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.header },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  back: { color: '#fff', fontSize: 24 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  body: { flex: 1, backgroundColor: colors.chatBg },
  list: { padding: 8 },
  bubble: { maxWidth: '80%', borderRadius: 8, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4, marginVertical: 2 },
  out: { alignSelf: 'flex-end', backgroundColor: colors.outgoing },
  in: { alignSelf: 'flex-start', backgroundColor: colors.incoming },
  msg: { fontSize: 16, color: colors.text },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4 },
  time: { fontSize: 11, color: colors.subtext },
  tick: { fontSize: 11, color: colors.subtext },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 22 },
  input: { flex: 1, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120, fontSize: 16 },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.header, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontSize: 18 },
});
