import { json } from '../../_lib/http.js';
import { issueSession, sessionCookieHeader } from '../../_lib/session.js';

export async function onRequestPost(context) {
  const { env } = context;
  if (env.DEMO_MODE !== 'true') return json({ error: 'not found' }, 404);

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
    await env.DB.prepare(
      `INSERT INTO users (id, org_id, email, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(userId, org.id, guestEmail, new Date().toISOString()).run();

    const token = await issueSession({ userId, orgId: org.id }, env.SESSION_SECRET);
    return json({ ok: true, guest: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) });
  } catch (err) {
    console.error('[auth/guest]', err.message);
    return json({ error: 'failed' }, 500);
  }
}
