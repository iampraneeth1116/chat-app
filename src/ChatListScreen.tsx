import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { Conversation, Message, User, createConversation, deleteConversation, getConversations, getMessages, getUsers } from './api';
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
  if (m.deletedForEveryone) {
    return m.senderId === meId ? 'You deleted this message' : 'This message was deleted';
  }
  const prefix = m.senderId === meId ? 'You: ' : '';
  const suffix = m.editedAt ? ' (edited)' : '';
  if (m.type === 'IMAGE') return `${prefix}${m.content ? `Photo · ${m.content}` : 'Photo'}${suffix}`;
  if (m.type === 'FILE') return `${prefix}${m.file?.name ?? 'Attachment'}${suffix}`;
  return prefix + m.content + suffix;
}

function PreviewStatusIcon({ m, meId }: { m: Message; meId: string }) {
  if (m.senderId !== meId || m.deletedForEveryone) return null;
  const others = Object.entries(m.status ?? {}).filter(([id]) => id !== meId);
  const read = others.length > 0 && others.every(([, s]) => s.read);
  const delivered = others.length > 0 && others.every(([, s]) => s.delivered || s.read);
  return (
    <Ionicons
      name={delivered ? 'checkmark-done' : 'checkmark'}
      size={15}
      color={read ? colors.accent : colors.muted}
      style={styles.previewTick}
    />
  );
}

export function ChatListScreen({ me, onOpen, onLogout }: Props) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [last, setLast] = useState<Record<string, Message | undefined>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
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

  const confirmLogout = () => {
    Alert.alert('Sign out', `Sign out of ${me.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: onLogout },
    ]);
  };

  const confirmDeleteChat = (c: Conversation, title: string) => {
    Alert.alert(
      'Delete chat',
      `Delete "${title}" for you? Other participants will still keep their messages.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete for me',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteConversation(c.id);
              if (!mounted.current) return;
              setConvos((prev) => prev.filter((item) => item.id !== c.id));
              setLast((prev) => {
                const next = { ...prev };
                delete next[c.id];
                return next;
              });
            } catch (e: unknown) {
              Alert.alert('Could not delete chat', e instanceof Error ? e.message : 'Please try again.');
            }
          },
        },
      ],
    );
  };

  // Most recent activity first; chats without messages fall back to their creation time.
  const sorted = useMemo(() => {
    const activity = (c: Conversation) => new Date(last[c.id]?.createdAt ?? c.createdAt).getTime() || 0;
    const ordered = [...convos].sort((a, b) => activity(b) - activity(a));
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((c) => {
      const title = conversationTitle(c, me.id, users).toLowerCase();
      const body = last[c.id]?.content?.toLowerCase() ?? '';
      return title.includes(q) || body.includes(q);
    });
  }, [convos, last, search, me.id, users]);

  const contacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    return Object.values(users)
      .filter((u) => u.id !== me.id)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.bio?.toLowerCase().includes(q) ?? false))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, me.id, contactQuery]);

  const openPicker = () => {
    setContactQuery('');
    setPicking(true);
  };

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
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Messages</Text>
          <View style={styles.userBadge}>
            <Text style={styles.userBadgeText} numberOfLines={1}>{me.name}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            onPress={openPicker}
            hitSlop={6}
            accessibilityLabel="New conversation">
            <Ionicons name="create-outline" size={21} color={colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            onPress={confirmLogout}
            hitSlop={6}
            accessibilityLabel="Sign out">
            <Ionicons name="log-out-outline" size={21} color={colors.subtext} />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={17} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search conversations"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {!!search && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {!!error && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color={colors.error} />
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
          <Pressable onPress={load} hitSlop={8}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={sorted}
        keyExtractor={(c) => c.id}
        contentContainerStyle={sorted.length === 0 ? styles.emptyListContent : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons
                  name={search.trim() ? 'search-outline' : 'chatbubbles-outline'}
                  size={28}
                  color={colors.brand}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {search.trim() ? 'No matching chats' : 'No conversations yet'}
              </Text>
              <Text style={styles.emptySub}>
                {search.trim()
                  ? 'Try a different name or keyword.'
                  : 'Start a direct message with someone on your team.'}
              </Text>
              {!search.trim() && (
                <Pressable
                  style={({ pressed }) => [styles.emptyCta, pressed && styles.emptyCtaPressed]}
                  onPress={openPicker}>
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                  <Text style={styles.emptyCtaText}>New conversation</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.brand} />
            </View>
          )
        }
        renderItem={({ item }) => {
          const title = conversationTitle(item, me.id, users);
          const m = last[item.id];
          const timestamp = m ? formatListTime(m.createdAt) : formatListTime(item.createdAt);
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => onOpen(item, title)}
              onLongPress={() => confirmDeleteChat(item, title)}
              delayLongPress={300}>
              <Avatar name={title} size={48} />
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={1}>{title}</Text>
                  {!!timestamp && <Text style={styles.time}>{timestamp}</Text>}
                </View>
                <View style={styles.previewRow}>
                  {m && <PreviewStatusIcon m={m} meId={me.id} />}
                  {!m?.deletedForEveryone && m?.type === 'IMAGE' && (
                    <Ionicons name="image-outline" size={14} color={colors.subtext} style={styles.previewMediaIcon} />
                  )}
                  {!m?.deletedForEveryone && m?.type === 'FILE' && (
                    <Ionicons name="document-outline" size={14} color={colors.subtext} style={styles.previewMediaIcon} />
                  )}
                  <Text style={styles.preview} numberOfLines={1}>{previewText(m, me.id)}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={openPicker}
        accessibilityLabel="Start new chat">
        <Ionicons name="add" size={26} color="#FFFFFF" />
      </Pressable>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New conversation</Text>
            <Pressable onPress={() => setPicking(false)} hitSlop={8}>
              <Text style={styles.modalClose}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={17} color={colors.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search contacts"
                placeholderTextColor={colors.muted}
                value={contactQuery}
                onChangeText={setContactQuery}
                autoCapitalize="none"
              />
              {!!contactQuery && (
                <Pressable onPress={() => setContactQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={17} color={colors.muted} />
                </Pressable>
              )}
            </View>
          </View>
          <FlatList
            data={contacts}
            keyExtractor={(u) => u.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={contacts.length === 0 ? styles.emptyListContent : styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="people-outline" size={26} color={colors.brand} />
                </View>
                <Text style={styles.emptyTitle}>
                  {contactQuery.trim() ? 'No contacts found' : 'No other users yet'}
                </Text>
                <Text style={styles.emptySub}>
                  {contactQuery.trim()
                    ? 'Try searching for another username.'
                    : 'Other accounts will appear here once they sign in.'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => startChat(item)}
                disabled={!!starting}>
                <Avatar name={item.name} size={44} />
                <View style={styles.rowBody}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.bio || 'Tap to send a message'}
                  </Text>
                </View>
                {starting === item.id ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                )}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  userBadge: {
    backgroundColor: colors.brandMuted,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    maxWidth: 130,
  },
  userBadgeText: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: {
    backgroundColor: colors.border,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 6,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: 10,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
  },
  retryText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingVertical: 4,
    paddingBottom: 92,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  loadingState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.brandMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 14,
    color: colors.subtext,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brand,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 18,
  },
  emptyCtaPressed: {
    backgroundColor: colors.accentPressed,
  },
  emptyCtaText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowPressed: {
    backgroundColor: colors.bg,
  },
  rowBody: {
    flex: 1,
    marginLeft: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    paddingBottom: 11,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  time: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  previewTick: {
    marginRight: 4,
  },
  previewMediaIcon: {
    marginRight: 4,
  },
  preview: {
    flex: 1,
    fontSize: 14,
    color: colors.subtext,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 26,
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabPressed: {
    backgroundColor: colors.accentPressed,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
  },
  modalClose: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
});
