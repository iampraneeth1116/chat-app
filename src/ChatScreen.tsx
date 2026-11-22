import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { Message, getFile, getMessages, sendMessage, uploadFile } from './api';
import { colors, formatTime } from './theme';

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
  return <Text style={[styles.tick, read && { color: colors.tick }]}>{delivered ? '✓✓' : '✓'}</Text>;
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

function ChatImage({ fileId }: { fileId: string }) {
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

  if (error) return <Text style={styles.msg}>⚠️ Image failed to load: {error}</Text>;
  if (!uri) {
    return (
      <View style={[styles.msgImage, styles.msgImageLoading]}>
        <ActivityIndicator color={colors.subtext} />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.msgImage} resizeMode="cover" />;
}

export function ChatScreen({ conversationId, title, meId, onBack }: Props) {
  // Newest first, rendered in an inverted list.
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [image, setImage] = useState<PendingImage | null>(null);
  const [preparing, setPreparing] = useState(false);
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

  const canSend = (!!text.trim() || !!image) && !sending && !preparing;

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
            const imageId = item.fileId ?? item.file?.id;
            return (
              <View style={[styles.bubble, mine ? styles.out : styles.in]}>
                {item.type === 'IMAGE' && (imageId ? <ChatImage fileId={imageId} /> : <Text style={styles.msg}>📷 Photo</Text>)}
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
        {(image || preparing) && (
          <View style={styles.preview}>
            {image ? (
              <Image source={{ uri: image.uri }} style={styles.previewImg} />
            ) : (
              <View style={[styles.previewImg, styles.msgImageLoading]}>
                <ActivityIndicator color={colors.subtext} />
              </View>
            )}
            <Text style={styles.previewLabel}>{image ? 'Photo ready to send' : 'Preparing photo…'}</Text>
            {image && !sending && (
              <Pressable onPress={() => setImage(null)} hitSlop={8}>
                <Text style={styles.previewRemove}>✕</Text>
              </Pressable>
            )}
          </View>
        )}
        <View style={styles.inputRow}>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder={image ? 'Add a caption' : 'Message'}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable onPress={pickImage} hitSlop={8} style={styles.upload} disabled={preparing || sending}>
              <Text style={styles.uploadText}>📎</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.send, !canSend && styles.sendDisabled]} onPress={send} disabled={!canSend}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>➤</Text>}
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
  msgImage: { width: 220, height: 220, borderRadius: 6, marginBottom: 4 },
  msgImageLoading: { backgroundColor: '#00000010', alignItems: 'center', justifyContent: 'center' },
  msg: { fontSize: 16, color: colors.text },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4 },
  time: { fontSize: 11, color: colors.subtext },
  tick: { fontSize: 11, color: colors.subtext },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 8, marginTop: 8, padding: 8, backgroundColor: '#fff', borderRadius: 12 },
  previewImg: { width: 56, height: 56, borderRadius: 8 },
  previewLabel: { flex: 1, color: colors.subtext },
  previewRemove: { fontSize: 18, color: colors.subtext },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 22 },
  input: { flex: 1, paddingLeft: 16, paddingVertical: 10, maxHeight: 120, fontSize: 16 },
  upload: { paddingHorizontal: 12, paddingVertical: 11 },
  uploadText: { fontSize: 20 },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.header, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontSize: 18 },
});
