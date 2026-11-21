import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { Conversation, Message, User, createConversation, getConversations, getMessages, getUsers } from './api';
import { colors, formatListTime } from './theme';

const POLL_MS = 5000;

type Props = {
  me: User;
  onOpen: (conversation: Conversation, title: string) => void;
  onLogout: () => void;
};

export function conversationTitle(c: Conversation, meId: string, users: Record<string, User>) {
  if (c.type === 'GROUP') return c.name || 'Group';
  const other = c.participants_ids.find((id) => id !== meId);
  return (other && users[other]?.name) || c.name || 'Chat';
}

function previewText(m: Message | undefined, meId: string) {
  if (!m) return 'No messages yet';
  const prefix = m.senderId === meId ? 'You: ' : '';
  if (m.type === 'IMAGE') return `${prefix}📷 ${m.content || 'Photo'}`;
  if (m.type === 'FILE') return `${prefix}📎 ${m.file?.name ?? 'File'}`;
  return prefix + m.content;
}

export function ChatListScreen({ me, onOpen, onLogout }: Props) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [last, setLast] = useState<Record<string, Message | undefined>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    // Skip if the previous poll hasn't finished, so slow responses don't pile up.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [cs, us] = await Promise.all([getConversations(), getUsers()]);
      // Pages are oldest-first, so the last item is the newest message.
      const pages = await Promise.all(cs.map((c) => getMessages(c.id).catch(() => null)));
      if (!mounted.current) return;
      setUsers(Object.fromEntries(us.map((u) => [u.id, u])));
      setConvos(cs);
      setLast(Object.fromEntries(cs.map((c, i) => [c.id, pages[i]?.data.at(-1)])));
      setError('');
    } catch (e: unknown) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Could not load chats');
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    if (mounted.current) setRefreshing(false);
  };

  // Most recent activity first; chats without messages fall back to their creation time.
  const sorted = useMemo(() => {
    const activity = (c: Conversation) => new Date(last[c.id]?.createdAt ?? c.createdAt).getTime() || 0;
    return [...convos].sort((a, b) => activity(b) - activity(a));
  }, [convos, last]);

  const contacts = useMemo(
    () => Object.values(users).filter((u) => u.id !== me.id).sort((a, b) => a.name.localeCompare(b.name)),
    [users, me.id],
  );

  const startChat = async (u: User) => {
    if (starting) return; // ignore double taps while a chat is being created
    // Reuse an existing DM with this person instead of creating a duplicate.
    const existing = convos.find(
      (c) => c.type === 'DM' && c.participants_ids.includes(u.id) && c.participants_ids.every((id) => id === u.id || id === me.id),
    );
    if (existing) {
      setPicking(false);
      onOpen(existing, u.name);
      return;
    }
    setStarting(u.id);
    try {
      const c = await createConversation([u.id]);
      if (!mounted.current) return;
      setConvos((prev) => (prev.some((p) => p.id === c.id) ? prev : [c, ...prev]));
      setPicking(false);
      onOpen(c, u.name);
    } catch (e: unknown) {
      Alert.alert('Could not start chat', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      if (mounted.current) setStarting(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={styles.headerAction}>Logout</Text>
        </Pressable>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={sorted}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={loaded ? <Text style={styles.empty}>No chats yet. Tap + to start one.</Text> : undefined}
        renderItem={({ item }) => {
          const title = conversationTitle(item, me.id, users);
          const m = last[item.id];
          return (
            <Pressable style={styles.row} onPress={() => onOpen(item, title)}>
              <Avatar name={title} />
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={1}>{title}</Text>
                  {m && <Text style={styles.time}>{formatListTime(m.createdAt)}</Text>}
                </View>
                <Text style={styles.preview} numberOfLines={1}>{previewText(m, me.id)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable style={styles.fab} onPress={() => setPicking(true)}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Select contact</Text>
            <Pressable onPress={() => setPicking(false)} hitSlop={8}>
              <Text style={styles.headerAction}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={contacts}
            keyExtractor={(u) => u.id}
            ListEmptyComponent={<Text style={styles.empty}>No other users yet.</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => startChat(item)} disabled={!!starting}>
                <Avatar name={item.name} />
                <View style={styles.rowBody}>
                  <Text style={styles.name}>{item.name}</Text>
                  {!!item.bio && <Text style={styles.preview} numberOfLines={1}>{item.bio}</Text>}
                </View>
                {starting === item.id && <ActivityIndicator color={colors.header} />}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { backgroundColor: colors.header, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '600' },
  headerAction: { color: '#fff', fontSize: 15 },
  error: { color: colors.error, textAlign: 'center', padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  rowBody: { flex: 1, marginLeft: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingBottom: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 17, fontWeight: '500', color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.subtext },
  preview: { color: colors.subtext, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.subtext, marginTop: 60 },
  fab: { position: 'absolute', right: 20, bottom: 30, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  fabText: { color: '#fff', fontSize: 28, marginTop: -2 },
});
