export const colors = {
  header: '#075E54',
  accent: '#25D366',
  chatBg: '#ECE5DD',
  outgoing: '#DCF8C6',
  incoming: '#FFFFFF',
  text: '#111B21',
  subtext: '#667781',
  tick: '#34B7F1',
  divider: '#E9EDEF',
  error: '#C0392B',
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

const AVATAR_COLORS = ['#128C7E', '#6B7C85', '#C0392B', '#8E44AD', '#2980B9', '#D35400'];
export function avatarColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

