import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { prisma } from './db.mjs';

const KEY_LENGTH = 64;

function authError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, hex] = storedHash.split(':');
  if (!salt || !hex) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Parses the app's custom `Basic username:password` header (raw, not base64).
 */
export function parseBasicHeader(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  const raw = header.slice('Basic '.length);
  const colon = raw.indexOf(':');
  if (colon <= 0) return null;
  const username = raw.slice(0, colon).trim();
  const password = raw.slice(colon + 1);
  if (!username || !password) return null;
  return { username, password };
}

export function toPublicUser(user) {
  return { id: user.id, name: user.name, bio: user.bio };
}

function validateCredentials(rawUsername, rawPassword) {
  const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
  const password = typeof rawPassword === 'string' ? rawPassword : '';
  if (username.length < 2 || username.length > 32) {
    throw authError(400, 'Username must be between 2 and 32 characters');
  }
  if (username.includes(':')) {
    throw authError(400, 'Username cannot contain ":"');
  }
  if (password.length < 4) {
    throw authError(400, 'Password must be at least 4 characters');
  }
  return { username, password };
}

/**
 * Registers a brand-new user account in PostgreSQL (Neon) via Prisma.
 */
export async function signupWithCredentials(body) {
  const { username, password } = validateCredentials(body?.username, body?.password);
  const bio = typeof body?.bio === 'string' && body.bio.trim() ? body.bio.trim().slice(0, 120) : null;

  const existing = await prisma.user.findUnique({ where: { name: username } });
  if (existing) {
    throw authError(409, 'Username is already taken');
  }

  try {
    const user = await prisma.user.create({
      data: {
        name: username,
        passwordHash: hashPassword(password),
        bio,
      },
    });
    return toPublicUser(user);
  } catch (e) {
    if (e?.code === 'P2002') {
      throw authError(409, 'Username is already taken');
    }
    throw e;
  }
}

/**
 * Verifies an existing user's username and password without auto-creating accounts.
 */
export async function loginWithCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) {
    throw authError(400, 'Username and password are required');
  }

  const user = await prisma.user.findUnique({ where: { name: username } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw authError(401, 'Invalid username or password');
  }
  return toPublicUser(user);
}

/**
 * Authenticates protected API requests using `Basic username:password`.
 */
export async function authenticateRequest(req) {
  const creds = parseBasicHeader(req.headers.authorization);
  if (!creds) {
    throw authError(401, 'Missing or invalid Authorization header');
  }

  const user = await prisma.user.findUnique({ where: { name: creds.username } });
  if (!user || !verifyPassword(creds.password, user.passwordHash)) {
    throw authError(401, 'Invalid username or password');
  }

  return toPublicUser(user);
}
