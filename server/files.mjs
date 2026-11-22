import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './db.mjs';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(SERVER_DIR, 'data', 'uploads');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function formatFileInfo(f) {
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    kind: f.kind,
    uploadedBy: f.uploadedBy,
    createdAt: f.createdAt.toISOString(),
    downloadUrl: `/file/${encodeURIComponent(f.id)}`,
  };
}

export async function handleUploadFile(body, me) {
  const rawName = typeof body.file_name === 'string' ? body.file_name.trim() : '';
  const mimeType = typeof body.mime_type === 'string' && body.mime_type.trim()
    ? body.mime_type.trim()
    : 'application/octet-stream';
  const base64 = typeof body.data === 'string' ? body.data.trim() : '';

  if (!rawName) throw httpError(400, 'file_name is required');
  if (!base64) throw httpError(400, 'data (base64) is required');

  // Strip optional data URI prefix if a client ever sends one.
  const cleaned = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) throw httpError(400, 'Invalid or empty base64 file data');
  if (buffer.length > MAX_FILE_BYTES) {
    throw httpError(413, 'File exceeds the 10 MB limit');
  }

  const safeName = path.basename(rawName);
  const kind = mimeType.toLowerCase().startsWith('image/') ? 'IMAGE' : 'FILE';
  const fileKey = `${randomUUID()}-${safeName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storagePath = path.join(UPLOADS_DIR, fileKey);

  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(storagePath, buffer);

  try {
    const record = await prisma.file.create({
      data: {
        name: safeName,
        mimeType,
        size: buffer.length,
        kind,
        storagePath,
        uploadedBy: me.id,
      },
    });
    return formatFileInfo(record);
  } catch (err) {
    await unlink(storagePath).catch(() => {});
    throw err;
  }
}

export async function handleGetFile(id) {
  const record = await prisma.file.findUnique({ where: { id } });
  if (!record) throw httpError(404, 'File not found');

  let buffer;
  try {
    buffer = await readFile(record.storagePath);
  } catch {
    throw httpError(404, 'File content missing on local disk');
  }

  return {
    ...formatFileInfo(record),
    data: buffer.toString('base64'),
  };
}
