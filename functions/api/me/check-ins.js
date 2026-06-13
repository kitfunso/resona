import { json } from '../../_lib/http.js';
import { getAuth } from '../../_lib/session.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/me/check-ins?limit=50 — personal history. Headlines are projected
// per-kind from the payload (in JS, since D1 has no jsonb operators); the raw
// payload never leaves the server.
export async function onRequestGet(context) {
  const auth = await getAuth(context);
  if (!auth) return json({ error: 'not authenticated' }, 401);

  const raw = new URL(context.request.url).searchParams.get('limit');
  const parsed = Number.parseInt(raw, 10);
  let limit;
  if (!Number.isFinite(parsed) || parsed < 1) limit = DEFAULT_LIMIT;
  else if (parsed > MAX_LIMIT) limit = MAX_LIMIT;
  else limit = parsed;

  try {
    const { results } = await context.env.DB.prepare(
      `SELECT id, kind, created_at, payload
         FROM check_ins
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    ).bind(auth.userId, limit).all();

    const checkIns = (results ?? []).map((row) => {
      let headline = null;
      try {
        const p = JSON.parse(row.payload);
        headline =
          row.kind === 'breath' ? p?.personalReport?.headline ?? null
          : row.kind === 'motion' ? p?.neuroReport?.headline ?? null
          : row.kind === 'heart' ? p?.heartReport?.headline ?? null
          : null;
      } catch {}
      return { id: row.id, kind: row.kind, createdAt: row.created_at, headline };
    });

    return json({ checkIns, limit, truncated: checkIns.length === limit });
  } catch (err) {
    console.error('[me/check-ins]', err.message);
    return json({ error: 'failed' }, 500);
  }
}
