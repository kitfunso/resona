import { json } from '../../_lib/http.js';
import { issueSession, sessionCookieHeader } from '../../_lib/session.js';

const MAX_DEMO_GUESTS = 25;

async function hasDemoAccess(header, secret) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret || '') || !header?.startsWith('Bearer ')) return false;
  const given = header.slice(7);
  if (given.length !== secret.length) return false;
  const encoder = new TextEncoder();
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const givenKey = await crypto.subtle.importKey('raw', encoder.encode(given), algorithm, false, ['sign']);
  const expectedKey = await crypto.subtle.importKey('raw', encoder.encode(secret), algorithm, false, ['verify']);
  const challenge = encoder.encode('resona-private-demo');
  const signature = await crypto.subtle.sign('HMAC', givenKey, challenge);
  return crypto.subtle.verify('HMAC', expectedKey, signature, challenge);
}

export async function onRequestPost(context) {
  const { env } = context;
  if (env.DEMO_MODE !== 'true') return json({ error: 'not found' }, 404);
  if (!(await hasDemoAccess(context.request.headers.get('authorization'), env.DEMO_ACCESS_TOKEN))) {
    return json({ error: 'demo access denied' }, 403);
  }
  if (typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32) {
    return json({ error: 'demo is unavailable' }, 503);
  }

  try {
    let org = await env.DB.prepare(`SELECT id FROM orgs WHERE slug = 'demo'`).first();
    if (!org) {
      await env.DB.prepare(
        `INSERT INTO orgs (id, slug, name, created_at) VALUES (?, 'demo', 'Demo', ?)
         ON CONFLICT(slug) DO NOTHING`,
      ).bind(crypto.randomUUID(), new Date().toISOString()).run();
      org = await env.DB.prepare(`SELECT id FROM orgs WHERE slug = 'demo'`).first();
    }

    const userId = crypto.randomUUID();
    const guestEmail = `guest-${crypto.randomUUID()}@demo.local`;
    const inserted = await env.DB.prepare(
      `INSERT INTO users (id, org_id, email, created_at)
       SELECT ?, ?, ?, ? WHERE
       (SELECT COUNT(*) FROM users WHERE org_id = ? AND email GLOB 'guest-*@demo.local') < ?
       RETURNING id`,
    ).bind(userId, org.id, guestEmail, new Date().toISOString(), org.id, MAX_DEMO_GUESTS).first();
    if (!inserted) return json({ error: 'The demo is full. Please ask the presenter for access.' }, 429);

    const token = await issueSession({ userId, orgId: org.id }, env.SESSION_SECRET);
    return json({ ok: true, guest: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) });
  } catch (err) {
    console.error('[auth/guest]', err.message);
    return json({ error: 'failed' }, 500);
  }
}
