import { Platform } from 'react-native';

// Defaults to the local backend server. Override with EXPO_PUBLIC_API_URL in .env
// when testing on a physical phone over Wi-Fi (e.g. http://192.168.1.10:3000).
const DEFAULT_LOCAL_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
export const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_LOCAL_URL).replace(/\/+$/, '');

export type User = { id: string; name: string; bio?: string | null };
export type Conversation = {
  id: string;
  name?: string | null;
  type: 'DM' | 'GROUP';
  createdAt: string;
  createdBy: string;
  participants_ids: string[];
};
export type FileInfo = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'IMAGE' | 'FILE';
  uploadedBy: string;
  createdAt: string;
  downloadUrl: string;
};
export type Message = {
  id: string;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE';
  fileId?: string | null;
  file?: FileInfo | null;
  createdAt: string;
  senderId: string;
  conversationId: string;
  status: Record<string, { delivered: boolean; read: boolean }>;
};
/** A page of messages, oldest first. `nextCursor` points at the next (older) page. */
export type MessagesPage = { data: Message[]; nextCursor?: string | null; count: number };
export type FileWithData = FileInfo & { data: string };

let authHeader = '';

export function setCredentials(username: string, password: string) {
  // The backend expects the raw "username:password", not base64.
  authHeader = `Basic ${username}:${password}`;
}

export function clearCredentials() {
  authHeader = '';
}

// Sensitive fields and long base64 payloads are redacted/trimmed so dev logs stay safe and readable.
const trim = (key: string, value: unknown) => {
  if (key === 'password' && typeof value === 'string') return '***';
  return typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}…(${value.length} chars)` : value;
};
const preview = (value: unknown) => (value === undefined ? '' : JSON.stringify(value, trim));

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const started = Date.now();
  if (__DEV__) {
    let logged: unknown = '';
    if (typeof init.body === 'string') {
      try {
        logged = JSON.parse(init.body);
      } catch {
        logged = init.body;
      }
    }
    console.log(`[api] → ${method} ${path}`, logged ? preview(logged) : '');
  }

  let res: Response;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (__DEV__) console.log(`[api] ✗ ${method} ${path} network error after ${Date.now() - started}ms:`, message);
    throw new Error(`Cannot reach the server at ${BASE_URL}. ${message}`);
  }

  const body = await res.json().catch(() => null);
  if (__DEV__) {
    console.log(`[api] ${res.ok ? '←' : '✗'} ${res.status} ${method} ${path} (${Date.now() - started}ms)`, preview(body));
  }
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return body as T;
}

export const loginUser = (username: string, password: string) =>
  request<User>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
export const signupUser = (username: string, password: string, bio?: string) =>
  request<User>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, password, bio: bio?.trim() || undefined }),
  });
export const getProfile = () => request<User>('/user/profile');
export const getUsers = () => request<User[]>('/user');
export const getConversations = () => request<Conversation[]>('/conversation');
export const createConversation = (participants_ids: string[], name?: string) =>
  request<Conversation>('/conversation', {
    method: 'POST',
    body: JSON.stringify({ type: participants_ids.length > 1 ? 'GROUP' : 'DM', participants_ids, name }),
  });
export const getMessages = (conversationId: string, cursor?: string | null) => {
  const params = new URLSearchParams({ conversation_id: conversationId });
  if (cursor) params.set('from_message_cursor', cursor);
  return request<MessagesPage>(`/message?${params.toString()}`);
};
export const getFile = (id: string) => request<FileWithData>(`/file/${encodeURIComponent(id)}`);
export const uploadFile = (file_name: string, mime_type: string, base64: string) =>
  request<FileInfo>('/file', {
    method: 'POST',
    body: JSON.stringify({ file_name, mime_type, data: base64 }),
  });
/** `content` is the caption when `fileId` is given. */
export const sendMessage = (conversationId: string, content?: string, fileId?: string) =>
  request<Message>('/message', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, content: content || undefined, file_id: fileId }),
  });

