import { prisma } from './db.mjs';
import { toPublicUser } from './auth.mjs';
import { fileMetadataSelect, formatFileInfo, handleGetFile, handleUploadFile } from './files.mjs';
import { notifyConversationParticipants, registerPushToken, unregisterPushToken } from './push.mjs';

const PAGE_SIZE = 30;
const MAX_BODY_BYTES = 16 * 1024 * 1024; // 16 MB (allows 10 MB base64 payloads in Phase 3)

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function readJsonBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, 'Invalid JSON body');
  }
}

export function formatConversation(c) {
  return {
    id: c.id,
    name: c.name ?? null,
    type: c.type,
    createdAt: c.createdAt.toISOString(),
    createdBy: c.createdBy,
    participants_ids: c.participants.map((p) => p.userId),
  };
}

export function formatMessage(m) {
  const status = {};
  for (const s of m.statuses ?? []) {
    status[s.userId] = { delivered: s.delivered, read: s.read };
  }
  return {
    id: m.id,
    content: m.content,
    type: m.type,
    fileId: m.fileId ?? null,
    file: formatFileInfo(m.file),
    deletedForEveryone: Boolean(m.deletedForEveryone),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
    senderId: m.senderId,
    conversationId: m.conversationId,
    status,
  };
}

async function assertParticipant(conversationId, userId) {
  const membership = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!membership) throw httpError(403, 'Not a participant in this conversation');
  return membership;
}

export async function handleApiRoute(req, url, me) {
  const method = req.method ?? 'GET';
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // GET /user/profile
  if (method === 'GET' && path === '/user/profile') {
    return { status: 200, data: me };
  }

  // GET /user
  if (method === 'GET' && path === '/user') {
    const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
    return { status: 200, data: users.map(toPublicUser) };
  }

  // GET /conversation
  if (method === 'GET' && path === '/conversation') {
    const convos = await prisma.conversation.findMany({
      where: { participants: { some: { userId: me.id, hidden: false } } },
      include: { participants: true },
      orderBy: { createdAt: 'desc' },
    });
    return { status: 200, data: convos.map(formatConversation) };
  }

  // POST /conversation
  if (method === 'POST' && path === '/conversation') {
    const body = await readJsonBody(req);
    const inputIds = Array.isArray(body.participants_ids)
      ? body.participants_ids.filter((id) => typeof id === 'string' && id.trim())
      : [];
    const participantIds = [...new Set([me.id, ...inputIds])];
    if (participantIds.length < 2) {
      throw httpError(400, 'At least one other participant is required');
    }

    const foundUsers = await prisma.user.findMany({
      where: { id: { in: participantIds } },
      select: { id: true },
    });
    if (foundUsers.length !== participantIds.length) {
      throw httpError(400, 'One or more participant IDs do not exist');
    }

    const type = body.type === 'GROUP' || participantIds.length > 2 ? 'GROUP' : 'DM';

    // Reuse an existing DM between the same two users instead of creating a duplicate.
    if (type === 'DM' && participantIds.length === 2) {
      const candidates = await prisma.conversation.findMany({
        where: {
          type: 'DM',
          participants: { some: { userId: participantIds[0] } },
          AND: { participants: { some: { userId: participantIds[1] } } },
        },
        include: { participants: true },
      });
      const existing = candidates.find(
        (c) =>
          c.participants.length === 2 &&
          c.participants.every((p) => participantIds.includes(p.userId)),
      );
      if (existing) {
        await prisma.conversationParticipant.updateMany({
          where: { conversationId: existing.id, userId: me.id, hidden: true },
          data: { hidden: false },
        });
        return { status: 200, data: formatConversation(existing) };
      }
    }

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
    const created = await prisma.conversation.create({
      data: {
        type,
        name,
        createdBy: me.id,
        participants: {
          create: participantIds.map((userId) => ({ userId })),
        },
      },
      include: { participants: true },
    });
    return { status: 201, data: formatConversation(created) };
  }

  // GET /message?conversation_id=...&from_message_cursor=...
  if (method === 'GET' && path === '/message') {
    const conversationId = url.searchParams.get('conversation_id');
    if (!conversationId) throw httpError(400, 'conversation_id is required');
    const membership = await assertParticipant(conversationId, me.id);

    const cursorId = url.searchParams.get('from_message_cursor');
    let cursorFilter = {};
    if (cursorId) {
      const cursorMsg = await prisma.message.findFirst({
        where: { id: cursorId, conversationId },
        select: { id: true, createdAt: true },
      });
      if (cursorMsg) {
        cursorFilter = {
          OR: [
            { createdAt: { lt: cursorMsg.createdAt } },
            { AND: [{ createdAt: cursorMsg.createdAt }, { id: { lt: cursorMsg.id } }] },
          ],
        };
      }
    }

    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        deletedBy: { none: { userId: me.id } },
        ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
        ...cursorFilter,
      },
      include: { file: { select: fileMetadataSelect }, statuses: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
    });

    const hasMore = rows.length > PAGE_SIZE;
    const pageDesc = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const nextCursor = hasMore ? pageDesc[pageDesc.length - 1].id : null;

    // Mark messages from other senders as delivered + read when fetched by this user.
    const unreadIds = pageDesc.filter((m) => m.senderId !== me.id).map((m) => m.id);
    if (unreadIds.length > 0) {
      await prisma.messageStatus.updateMany({
        where: { messageId: { in: unreadIds }, userId: me.id },
        data: { delivered: true, read: true },
      });
      for (const m of pageDesc) {
        if (m.senderId === me.id) continue;
        const entry = m.statuses.find((s) => s.userId === me.id);
        if (entry) {
          entry.delivered = true;
          entry.read = true;
        } else {
          m.statuses.push({ messageId: m.id, userId: me.id, delivered: true, read: true });
        }
      }
    }

    // Frontend expects pages in oldest-first order.
    const data = pageDesc.reverse().map(formatMessage);
    return { status: 200, data: { data, nextCursor, count: data.length } };
  }

  // POST /message
  if (method === 'POST' && path === '/message') {
    const body = await readJsonBody(req);
    const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : '';
    if (!conversationId) throw httpError(400, 'conversation_id is required');
    await assertParticipant(conversationId, me.id);

    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const fileId = typeof body.file_id === 'string' && body.file_id.trim() ? body.file_id.trim() : null;
    if (!content && !fileId) {
      throw httpError(400, 'Message must include content or file_id');
    }

    let messageType = 'TEXT';
    if (fileId) {
      const file = await prisma.file.findUnique({ where: { id: fileId }, select: { kind: true } });
      if (!file) throw httpError(404, 'Attached file not found');
      messageType = file.kind === 'IMAGE' ? 'IMAGE' : 'FILE';
    }

    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    const recipientIds = participants.map((p) => p.userId).filter((id) => id !== me.id);

    const created = await prisma.message.create({
      data: {
        conversationId,
        senderId: me.id,
        content,
        type: messageType,
        fileId,
        statuses: {
          create: recipientIds.map((userId) => ({ userId, delivered: false, read: false })),
        },
      },
      include: { file: { select: fileMetadataSelect }, statuses: true },
    });

    await prisma.conversationParticipant.updateMany({
      where: { conversationId, hidden: true },
      data: { hidden: false },
    });

    const formatted = formatMessage(created);
    notifyConversationParticipants({
      conversationId,
      senderName: me.name,
      recipientIds,
      message: formatted,
    }).catch((err) => {
      console.error('[push] Failed to send notification:', err);
    });

    return { status: 201, data: formatted };
  }

  // PATCH /message/:id
  if (method === 'PATCH' && path.startsWith('/message/')) {
    const id = decodeURIComponent(path.slice('/message/'.length));
    if (!id || id.includes('/')) throw httpError(400, 'Invalid message id');

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) throw httpError(404, 'Message not found');
    await assertParticipant(message.conversationId, me.id);

    if (message.senderId !== me.id) {
      throw httpError(403, 'Only the sender can edit a message');
    }
    if (message.deletedForEveryone) {
      throw httpError(400, 'Cannot edit a deleted message');
    }

    const body = await readJsonBody(req);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content && !message.fileId) {
      throw httpError(400, 'Message content cannot be empty');
    }

    const updated = await prisma.message.update({
      where: { id },
      data: {
        content,
        editedAt: new Date(),
      },
      include: { file: { select: fileMetadataSelect }, statuses: true },
    });
    return { status: 200, data: formatMessage(updated) };
  }

  // DELETE /message/:id?scope=me|everyone
  if (method === 'DELETE' && path.startsWith('/message/')) {
    const id = decodeURIComponent(path.slice('/message/'.length));
    if (!id || id.includes('/')) throw httpError(400, 'Invalid message id');
    const scope = url.searchParams.get('scope') === 'everyone' ? 'everyone' : 'me';

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) throw httpError(404, 'Message not found');
    await assertParticipant(message.conversationId, me.id);

    if (scope === 'everyone') {
      if (message.senderId !== me.id) {
        throw httpError(403, 'Only the sender can delete a message for everyone');
      }
      const updated = await prisma.message.update({
        where: { id },
        data: {
          content: '',
          type: 'TEXT',
          fileId: null,
          deletedForEveryone: true,
        },
        include: { file: { select: fileMetadataSelect }, statuses: true },
      });
      if (message.fileId) {
        await prisma.file.deleteMany({ where: { id: message.fileId } }).catch(() => {});
      }
      return { status: 200, data: formatMessage(updated) };
    }

    await prisma.deletedMessage.upsert({
      where: { messageId_userId: { messageId: id, userId: me.id } },
      update: {},
      create: { messageId: id, userId: me.id },
    });
    return { status: 200, data: { ok: true, id, scope: 'me' } };
  }

  // DELETE /conversation/:id (clears and hides conversation for the current user only)
  if (method === 'DELETE' && path.startsWith('/conversation/')) {
    const id = decodeURIComponent(path.slice('/conversation/'.length));
    if (!id || id.includes('/')) throw httpError(400, 'Invalid conversation id');
    await assertParticipant(id, me.id);

    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId: me.id } },
      data: { hidden: true, clearedAt: new Date() },
    });
    return { status: 200, data: { ok: true, id } };
  }

  // POST /push/register
  if (method === 'POST' && path === '/push/register') {
    const body = await readJsonBody(req);
    const result = await registerPushToken(me.id, body);
    return { status: 200, data: result };
  }

  // POST /push/unregister
  if (method === 'POST' && path === '/push/unregister') {
    const body = await readJsonBody(req);
    const result = await unregisterPushToken(me.id, body);
    return { status: 200, data: result };
  }

  // POST /file
  if (method === 'POST' && path === '/file') {
    const body = await readJsonBody(req);
    const file = await handleUploadFile(body, me);
    return { status: 201, data: file };
  }

  // GET /file/:id
  if (method === 'GET' && path.startsWith('/file/')) {
    const id = decodeURIComponent(path.slice('/file/'.length));
    if (!id || id.includes('/')) throw httpError(400, 'Invalid file id');
    const file = await handleGetFile(id);
    return { status: 200, data: file };
  }

  return null;
}
