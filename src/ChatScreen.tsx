import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { Message, deleteConversation, deleteMessage, editMessage, getFile, getMessages, sendMessage, uploadFile } from './api';
import { colors, formatDayLabel, formatTime, isSameDay } from './theme';

const POLL_MS = 3000;
const MAX_IMAGE_WIDTH = 1280;
const IMAGE_CACHE_LIMIT = 50;

type Props = { conversationId: string; title: string; meId: string; onBack: () => void };
type PendingImage = { uri: string; base64: string; name: string };

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
  return (
    <Ionicons
      name={delivered ? 'checkmark-done' : 'checkmark'}
      size={14}
      color={read ? colors.tickRead : colors.tickSent}
    />
  );
}

// Native <Image> can't be trusted to forward our non-standard Authorization header (it 401s),
// so images are fetched through the authenticated JSON endpoint and shown as data URIs.
// The cache is capped so long chats don't keep every image in memory, and concurrent
// requests for the same file share one download.
const imageCache = new Map<string, string>();
const imageRequests = new Map<string, Promise<string>>();

function loadImage(fileId: string): Promise<string> {
  const cached = imageCache.get(fileId);
  if (cached) return Promise.resolve(cached);
  let req = imageRequests.get(fileId);
  if (!req) {
    req = getFile(fileId)
      .then((f) => {
        const dataUri = `data:${f.mimeType || 'image/jpeg'};base64,${f.data}`;
        imageCache.set(fileId, dataUri);
        if (imageCache.size > IMAGE_CACHE_LIMIT) {
          const oldest = imageCache.keys().next().value;
          if (oldest !== undefined) imageCache.delete(oldest);
        }
        return dataUri;
      })
      .finally(() => imageRequests.delete(fileId));
    imageRequests.set(fileId, req);
  }
  return req;
}

function ChatImage({
  fileId,
  mine,
  onOpenViewer,
  onLongPress,
}: {
  fileId: string;
  mine: boolean;
  onOpenViewer: (uri: string) => void;
  onLongPress: () => void;
}) {
  const [uri, setUri] = useState(() => imageCache.get(fileId) ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    setUri(imageCache.get(fileId) ?? '');
    loadImage(fileId)
      .then((u) => active && setUri(u))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Unknown error'));
    return () => {
      active = false;
    };
  }, [fileId]);

  if (error) {
    return (
      <View style={styles.imgErrorBox}>
        <Ionicons name="alert-circle-outline" size={16} color={mine ? colors.outgoingText : colors.error} />
        <Text style={[styles.imgErrorText, mine && styles.outText]}>Image unavailable</Text>
      </View>
    );
  }
  if (!uri) {
    return (
      <View style={[styles.msgImage, styles.msgImageLoading]}>
        <ActivityIndicator color={mine ? '#FFFFFF' : colors.subtext} />
      </View>
    );
  }
  return (
    <Pressable onPress={() => onOpenViewer(uri)} onLongPress={onLongPress} delayLongPress={250}>
      <Image source={{ uri }} style={styles.msgImage} resizeMode="cover" />
    </Pressable>
  );
}

export function ChatScreen({ conversationId, title, meId, onBack }: Props) {
  // Newest first, rendered in an inverted list.
  const [messages, setMessages] = useState<Message[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [image, setImage] = useState<PendingImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
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
      if (mounted.current) setInitialLoading(false);
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

  const pickImage = async () => {
    if (preparing || sending) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          Alert.alert('Permission needed', 'Photo access is needed to attach images.');
        } else {
          // Denied permanently: the system won't prompt again, so send them to Settings.
          Alert.alert('Photo access blocked', 'Enable photo access for this app in Settings to attach images.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
        }
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      setPreparing(true);
      // Downscale before upload: phone photos are huge and the API caps files at 10 MB.
      // Only shrink; never upscale small images.
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (asset.width > MAX_IMAGE_WIDTH) ctx.resize({ width: MAX_IMAGE_WIDTH });
      const rendered = await ctx.renderAsync();
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
      if (!out.base64) throw new Error('Image could not be encoded');
      if (mounted.current) setImage({ uri: out.uri, base64: out.base64, name: `photo-${Date.now()}.jpg` });
    } catch {
      if (mounted.current) Alert.alert('Something went wrong', 'Could not attach that photo. Please try again.');
    } finally {
      if (mounted.current) setPreparing(false);
    }
  };

  const send = async () => {
    const content = text.trim();
    if (editingMessage) {
      if ((!content && !editingMessage.fileId) || sending) return;
      const target = editingMessage;
      setSending(true);
      setText('');
      setEditingMessage(null);
      try {
        const updated = await editMessage(target.id, content);
        if (mounted.current) setMessages((prev) => mergeMessages(prev, [updated]));
      } catch (e: unknown) {
        if (!mounted.current) return;
        setText(content);
        setEditingMessage(target);
        Alert.alert('Could not edit', e instanceof Error ? e.message : 'Please try again.');
      } finally {
        if (mounted.current) setSending(false);
      }
      return;
    }

    if ((!content && !image) || sending) return;
    const pending = image;
    setSending(true);
    setText('');
    setImage(null);
    try {
      // Upload first, then send one message that references the file; the text becomes its caption.
      const file = pending ? await uploadFile(pending.name, 'image/jpeg', pending.base64) : null;
      const m = await sendMessage(conversationId, content, file?.id);
      if (mounted.current) setMessages((prev) => mergeMessages(prev, [m]));
    } catch (e: unknown) {
      if (!mounted.current) return;
      setText(content);
      setImage(pending);
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const canSend = editingMessage
    ? (!!text.trim() || !!editingMessage.fileId) && text.trim() !== editingMessage.content && !sending
    : (!!text.trim() || !!image) && !sending && !preparing;

  const startEditing = (m: Message) => {
    setSelectedMessage(null);
    setImage(null);
    setEditingMessage(m);
    setText(m.content);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setText('');
  };

  const handleDeleteMessage = async (scope: 'me' | 'everyone') => {
    if (!selectedMessage || deleting) return;
    const target = selectedMessage;
    setDeleting(true);
    try {
      const result = await deleteMessage(target.id, scope);
      if (!mounted.current) return;
      if (scope === 'everyone' && 'id' in result && 'createdAt' in result) {
        setMessages((prev) => mergeMessages(prev, [result]));
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== target.id));
      }
      setSelectedMessage(null);
    } catch (e: unknown) {
      Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      if (mounted.current) setDeleting(false);
    }
  };

  const confirmDeleteChat = () => {
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
              await deleteConversation(conversationId);
              if (mounted.current) onBack();
            } catch (e: unknown) {
              Alert.alert('Could not delete chat', e instanceof Error ? e.message : 'Please try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          onPress={onBack}
          hitSlop={10}
          accessibilityLabel="Back to chats">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Avatar name={title} size={38} />
        <View style={styles.headerTextWrap}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle}>Conversation</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          onPress={confirmDeleteChat}
          hitSlop={8}
          accessibilityLabel="Delete chat">
          <Ionicons name="trash-outline" size={20} color={colors.subtext} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={messages.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            initialLoading ? (
              <View style={styles.emptyCenter}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : (
              <View style={styles.emptyCenter}>
                <View style={styles.emptyCard}>
                  <Ionicons name="chatbubble-outline" size={22} color={colors.brand} />
                  <Text style={styles.emptyTitle}>Say hello to {title}</Text>
                  <Text style={styles.emptySub}>Messages sent here are saved to your workspace.</Text>
                </View>
              </View>
            )
          }
          renderItem={({ item, index }) => {
            const mine = item.senderId === meId;
            const older = messages[index + 1];
            const newer = messages[index - 1];
            const showDateHeader = !older || !isSameDay(item.createdAt, older.createdAt);
            const groupedWithNewer =
              !!newer && newer.senderId === item.senderId && isSameDay(item.createdAt, newer.createdAt);
            const imageId = item.fileId ?? item.file?.id;

            return (
              <View>
                {showDateHeader && (
                  <View style={styles.dateRow}>
                    <View style={styles.datePill}>
                      <Text style={styles.dateText}>{formatDayLabel(item.createdAt)}</Text>
                    </View>
                  </View>
                )}
                <Pressable
                  onLongPress={() => setSelectedMessage(item)}
                  delayLongPress={250}
                  style={[
                    styles.bubble,
                    mine ? styles.out : styles.in,
                    groupedWithNewer ? styles.bubbleGrouped : styles.bubbleTailGap,
                  ]}>
                  {item.deletedForEveryone ? (
                    <View style={styles.deletedRow}>
                      <Ionicons
                        name="ban-outline"
                        size={14}
                        color={mine ? colors.outgoingSubtext : colors.muted}
                      />
                      <Text style={[styles.deletedText, mine && styles.outDeletedText]}>
                        {mine ? 'You deleted this message' : 'This message was deleted'}
                      </Text>
                    </View>
                  ) : (
                    <>
                      {item.type === 'IMAGE' &&
                        (imageId ? (
                          <ChatImage
                            fileId={imageId}
                            mine={mine}
                            onOpenViewer={setViewerUri}
                            onLongPress={() => setSelectedMessage(item)}
                          />
                        ) : (
                          <View style={styles.fileRow}>
                            <Ionicons name="image-outline" size={16} color={mine ? '#FFFFFF' : colors.text} />
                            <Text style={[styles.msg, mine && styles.outText]}>Photo</Text>
                          </View>
                        ))}
                      {item.type === 'FILE' && (
                        <View style={styles.fileRow}>
                          <Ionicons name="document-outline" size={16} color={mine ? '#FFFFFF' : colors.text} />
                          <Text style={[styles.msg, mine && styles.outText]}>
                            {item.file?.name ?? 'Attachment'}
                          </Text>
                        </View>
                      )}
                      {!!item.content && <Text style={[styles.msg, mine && styles.outText]}>{item.content}</Text>}
                    </>
                  )}
                  <View style={styles.meta}>
                    <Text style={[styles.time, mine && styles.outTime]}>
                      {!item.deletedForEveryone && item.editedAt
                        ? `${formatTime(item.createdAt)} · Edited ${formatTime(item.editedAt)}`
                        : formatTime(item.createdAt)}
                    </Text>
                    {mine && !item.deletedForEveryone && <Ticks m={item} meId={meId} />}
                  </View>
                </Pressable>
              </View>
            );
          }}
        />

        {editingMessage && (
          <View style={styles.preview}>
            <View style={styles.editAccentBar} />
            <View style={styles.previewInfo}>
              <Text style={styles.previewTitle}>
                Editing message ({formatTime(editingMessage.createdAt)})
              </Text>
              <Text style={styles.previewSub} numberOfLines={1}>
                {editingMessage.content || 'Photo caption'}
              </Text>
            </View>
            {!sending && (
              <Pressable style={styles.previewRemoveBtn} onPress={cancelEditing} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.subtext} />
              </Pressable>
            )}
          </View>
        )}

        {(image || preparing) && !editingMessage && (
          <View style={styles.preview}>
            {image ? (
              <Image source={{ uri: image.uri }} style={styles.previewImg} />
            ) : (
              <View style={[styles.previewImg, styles.previewLoading]}>
                <ActivityIndicator color={colors.brand} />
              </View>
            )}
            <View style={styles.previewInfo}>
              <Text style={styles.previewTitle}>{image ? 'Photo ready' : 'Preparing photo…'}</Text>
              <Text style={styles.previewSub}>{image ? 'Add a caption or send now' : 'Optimizing image size'}</Text>
            </View>
            {image && !sending && (
              <Pressable style={styles.previewRemoveBtn} onPress={() => setImage(null)} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.subtext} />
              </Pressable>
            )}
          </View>
        )}

        <View style={styles.composerBar}>
          {!editingMessage && (
            <Pressable
              onPress={pickImage}
              hitSlop={6}
              style={({ pressed }) => [styles.attachBtn, pressed && styles.attachBtnPressed]}
              disabled={preparing || sending}
              accessibilityLabel="Attach photo">
              <Ionicons name="image-outline" size={21} color={colors.subtext} />
            </Pressable>
          )}
          <View style={styles.inputBox}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={editingMessage ? 'Edit message…' : image ? 'Add a caption…' : 'Write a message…'}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.send,
              !canSend && styles.sendDisabled,
              pressed && canSend && styles.sendPressed,
            ]}
            onPress={send}
            disabled={!canSend}
            accessibilityLabel={editingMessage ? 'Save edit' : 'Send message'}>
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name={editingMessage ? 'checkmark' : 'arrow-up'} size={20} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewerBackdrop}>
          <SafeAreaView style={styles.viewerSafe}>
            <View style={styles.viewerTopBar}>
              <Pressable style={styles.viewerCloseBtn} onPress={() => setViewerUri(null)} hitSlop={12}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />}
          </SafeAreaView>
        </View>
      </Modal>

      <Modal
        visible={!!selectedMessage}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleting) setSelectedMessage(null);
        }}>
        <Pressable
          style={styles.actionBackdrop}
          onPress={() => !deleting && setSelectedMessage(null)}>
          <View style={styles.actionSheet}>
            <Text style={styles.actionTitle}>Message options</Text>
            {selectedMessage && (
              <Text style={styles.actionPreview} numberOfLines={2}>
                {selectedMessage.deletedForEveryone
                  ? 'Deleted message'
                  : selectedMessage.content || (selectedMessage.type === 'IMAGE' ? 'Photo' : 'Attachment')}
              </Text>
            )}

            {selectedMessage?.senderId === meId && !selectedMessage?.deletedForEveryone && (
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
                onPress={() => startEditing(selectedMessage)}
                disabled={deleting}>
                <Ionicons name="create-outline" size={18} color={colors.brand} />
                <Text style={styles.actionNormalText}>Edit message</Text>
              </Pressable>
            )}

            {selectedMessage?.senderId === meId && !selectedMessage?.deletedForEveryone && (
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
                onPress={() => handleDeleteMessage('everyone')}
                disabled={deleting}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
                <Text style={styles.actionDestructiveText}>Delete for everyone</Text>
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
              onPress={() => handleDeleteMessage('me')}
              disabled={deleting}>
              <Ionicons name="eye-off-outline" size={18} color={colors.text} />
              <Text style={styles.actionNormalText}>Delete for me</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.actionCancelBtn, pressed && styles.actionBtnPressed]}
              onPress={() => setSelectedMessage(null)}
              disabled={deleting}>
              {deleting ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Text style={styles.actionCancelText}>Cancel</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  headerTextWrap: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.subtext, fontSize: 12, marginTop: 1 },
  body: { flex: 1, backgroundColor: colors.chatBg },
  list: { paddingHorizontal: 12, paddingVertical: 10 },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  emptyCenter: { alignItems: 'center', justifyContent: 'center' },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: 'center',
    maxWidth: 280,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 10 },
  emptySub: { fontSize: 13, color: colors.subtext, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  dateRow: { alignItems: 'center', marginVertical: 12 },
  datePill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dateText: { fontSize: 12, fontWeight: '500', color: colors.subtext },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  bubbleGrouped: { marginVertical: 1.5 },
  bubbleTailGap: { marginTop: 1.5, marginBottom: 7 },
  out: {
    alignSelf: 'flex-end',
    backgroundColor: colors.outgoing,
    borderBottomRightRadius: 4,
  },
  in: {
    alignSelf: 'flex-start',
    backgroundColor: colors.incoming,
    borderWidth: 1,
    borderColor: colors.incomingBorder,
    borderBottomLeftRadius: 4,
  },
  msgImage: { width: 224, height: 224, borderRadius: 10, marginBottom: 6 },
  msgImageLoading: { backgroundColor: 'rgba(15, 23, 42, 0.08)', alignItems: 'center', justifyContent: 'center' },
  imgErrorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  imgErrorText: { fontSize: 14, color: colors.error },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  msg: { fontSize: 15, lineHeight: 21, color: colors.text },
  outText: { color: colors.outgoingText },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4, marginTop: 3 },
  time: { fontSize: 11, color: colors.muted },
  outTime: { color: colors.outgoingSubtext },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  previewImg: { width: 48, height: 48, borderRadius: 8 },
  editAccentBar: { width: 3, height: 34, borderRadius: 2, backgroundColor: colors.brand },
  previewLoading: { backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  previewInfo: { flex: 1 },
  previewTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  previewSub: { fontSize: 12, color: colors.subtext, marginTop: 1 },
  previewRemoveBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtnPressed: { backgroundColor: colors.border },
  inputBox: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    minHeight: 38,
    justifyContent: 'center',
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    maxHeight: 110,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: { backgroundColor: colors.accentPressed },
  sendDisabled: { backgroundColor: colors.muted, opacity: 0.55 },
  viewerBackdrop: { flex: 1, backgroundColor: '#0B0F14' },
  viewerSafe: { flex: 1 },
  viewerTopBar: { alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 10 },
  viewerCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: { flex: 1, width: '100%' },
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deletedText: { fontSize: 14, fontStyle: 'italic', color: colors.subtext },
  outDeletedText: { color: colors.outgoingSubtext },
  actionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  actionSheet: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  actionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  actionPreview: { fontSize: 13, color: colors.subtext, marginBottom: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.bg,
  },
  actionBtnPressed: { backgroundColor: colors.surfaceAlt },
  actionDestructiveText: { fontSize: 15, fontWeight: '600', color: colors.error },
  actionNormalText: { fontSize: 15, fontWeight: '600', color: colors.text },
  actionCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    marginTop: 2,
  },
  actionCancelText: { fontSize: 15, fontWeight: '600', color: colors.subtext },
});
