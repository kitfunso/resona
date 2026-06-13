// Session cookie constants + helpers. Mirrors the old server's resona_session
// cookie (HttpOnly, SameSite=Lax, Secure, 30d). Pages always serves over
// HTTPS, so Secure is unconditional here.

import { signSession, verifySession } from './jwt.js';
import { readCookie } from './http.js';

export const SESSION_COOKIE = 'resona_session';
export const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

export function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function issueSession({ userId, orgId }, secret) {
  return signSession({ userId, orgId }, secret, SESSION_TTL_SEC);
}

// Returns { userId, orgId } or null. Never throws.
export async function getAuth(context) {
  const token = readCookie(context.request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const p = await verifySession(token, context.env.SESSION_SECRET);
    return { userId: p.userId, orgId: p.orgId };
  } catch {
    return null;
  }
}
