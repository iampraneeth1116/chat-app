import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { prisma } from './db.mjs';

const KEY_LENGTH = 64;

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

/**
 * Authenticates the request against PostgreSQL (Neon) via Prisma.
 * New usernames are registered automatically; existing usernames require a matching password.
 */
export async function authenticateRequest(req) {
  const creds = parseBasicHeader(req.headers.authorization);
  if (!creds) {
    const err = new Error('Missing or invalid Authorization header');
    err.status = 401;
    throw err;
  }

  let user = await prisma.user.findUnique({ where: { name: creds.username } });
  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          name: creds.username,
          passwordHash: hashPassword(creds.password),
        },
      });
    } catch (e) {
      // Handle race condition if two requests register the same username simultaneously.
      if (e?.code === 'P2002') {
        user = await prisma.user.findUnique({ where: { name: creds.username } });
      } else {
        throw e;
      }
    }
  }

  if (!user || !verifyPassword(creds.password, user.passwordHash)) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }

  return toPublicUser(user);
}
