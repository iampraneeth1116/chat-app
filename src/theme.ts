export const colors = {
  // Brand & interactive accents (deep teal, clean flat surfaces)
  brand: '#0B4F4A',
  brandMuted: '#E6F0EF',
  accent: '#0D7A72',
  accentPressed: '#095E58',

  // Surfaces
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  chatBg: '#F3F4F6',

  // Message bubbles
  outgoing: '#0B4F4A',
  outgoingText: '#FFFFFF',
  outgoingSubtext: 'rgba(255, 255, 255, 0.72)',
  incoming: '#FFFFFF',
  incomingBorder: '#E2E8F0',

  // Typography & borders
  text: '#0F172A',
  subtext: '#64748B',
  muted: '#94A3B8',
  border: '#E2E8F0',
  divider: '#EEF2F6',

  // Status
  tickSent: 'rgba(255, 255, 255, 0.65)',
  tickRead: '#5EEAD4',
  error: '#DC2626',
  errorBg: '#FEF2F2',
  errorBorder: '#FECACA',
};

/** Time of day, e.g. "14:05". */
export function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** For the chat list: time if today, "Yesterday", otherwise a short date. */
export function formatListTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (d.getTime() >= startOfToday) return formatTime(iso);
  if (d.getTime() >= startOfToday - dayMs) return 'Yesterday';
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Date divider label inside a chat thread, e.g. "Today", "Yesterday", or "Nov 22, 2026". */
export function formatDayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (startOfTarget === startOfToday) return 'Today';
  if (startOfTarget === startOfToday - dayMs) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isSameDay(aIso: string, bIso: string) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const AVATAR_COLORS = ['#0F766E', '#1D4ED8', '#6D28D9', '#B45309', '#BE123C', '#334155'];
export function avatarColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
