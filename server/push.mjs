import { prisma } from './db.mjs';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isExpoPushToken(token) {
  return (
    typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) &&
    token.endsWith(']')
  );
}

export async function registerPushToken(userId, body) {
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const platform = typeof body?.platform === 'string' ? body.platform.trim().slice(0, 32) : null;
  if (!isExpoPushToken(token)) {
    throw httpError(400, 'Valid Expo push token is required');
  }

  await prisma.pushToken.upsert({
    where: { token },
    update: { userId, platform },
    create: { token, userId, platform },
  });
  return { ok: true };
}

export async function unregisterPushToken(userId, body) {
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return { ok: true };
  await prisma.pushToken.deleteMany({
    where: { token, userId },
  });
  return { ok: true };
}

function formatNotificationBody(message) {
  if (message.type === 'IMAGE') {
    return message.content ? `📷 ${message.content}` : '📷 Sent a photo';
  }
  if (message.type === 'FILE') {
    return `📎 ${message.file?.name ?? 'Sent a file'}`;
  }
  return message.content;
}

export async function notifyConversationParticipants({
  conversationId,
  senderName,
  recipientIds,
  message,
}) {
  if (!recipientIds.length) return;

  const [tokens, conversation] = await Promise.all([
    prisma.pushToken.findMany({
      where: { userId: { in: recipientIds } },
      select: { token: true },
    }),
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true, name: true },
    }),
  ]);

  if (!tokens.length) return;

  const isGroup = conversation?.type === 'GROUP';
  const chatTitle = isGroup ? conversation.name || 'Group' : senderName;
  const notificationTitle = isGroup ? `${senderName} · ${chatTitle}` : senderName;
  const body = formatNotificationBody(message);

  const payloads = tokens.map(({ token }) => ({
    to: token,
    sound: 'default',
    channelId: 'messages',
    title: notificationTitle,
    body,
    data: {
      conversationId,
      title: chatTitle,
    },
  }));

  // Expo Push API accepts up to 100 messages per request.
  for (let i = 0; i < payloads.length; i += 100) {
    const chunk = payloads.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });

    const json = await res.json().catch(() => null);
    const tickets = Array.isArray(json?.data) ? json.data : [];
    const staleTokens = [];
    tickets.forEach((ticket, idx) => {
      if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
        staleTokens.push(chunk[idx].to);
      }
    });

    if (staleTokens.length > 0) {
      await prisma.pushToken.deleteMany({ where: { token: { in: staleTokens } } });
    }
  }
}
