import { json } from '../_lib/http.js';
import { getAuth } from '../_lib/session.js';
import { loadCurrentUser } from '../_lib/db.js';

const SEX_VALUES = new Set(['male', 'female', 'intersex', 'other', 'prefer-not-to-say']);
const ETHNICITY_VALUES = new Set([
  'Caucasian', 'African', 'African-American', 'Hispanic', 'East Asian',
  'South Asian', 'Southeast Asian', 'Middle Eastern', 'Indigenous', 'Mixed', 'Other',
]);

// GET /api/me
export async function onRequestGet(context) {
  const auth = await getAuth(context);
  if (!auth) return json({ error: 'not authenticated' }, 401);
  const user = await loadCurrentUser(context.env, auth.userId);
  if (!user) return json({ error: 'user not found' }, 404);
  return json({ user });
}

// PATCH /api/me — partial profile update. Validation mirrors the old server:
// unknown / malformed fields are ignored rather than rejected.
export async function onRequestPatch(context) {
  const auth = await getAuth(context);
  if (!auth) return json({ error: 'not authenticated' }, 401);

  const body = await context.request.json().catch(() => ({}));
  const { name, dob, heightCm, sex, ethnicity } = body ?? {};
  const allowed = {};

  if (typeof name === 'string') {
    const cleaned = name.replace(/[^\p{L}\p{M} .'\-]/gu, '').slice(0, 200).trim();
    if (cleaned.length > 0) allowed.name = cleaned;
  }
  if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    const d = new Date(`${dob}T00:00:00Z`);
    const yr = d.getUTCFullYear();
    if (!Number.isNaN(d.getTime()) && yr >= 1900 && d.getTime() <= Date.now()) {
      allowed.dob = dob;
    }
  }
  if (Number.isInteger(heightCm) && heightCm > 50 && heightCm < 250) allowed.height_cm = heightCm;
  if (typeof sex === 'string' && SEX_VALUES.has(sex)) allowed.sex = sex;
  if (typeof ethnicity === 'string' && ETHNICITY_VALUES.has(ethnicity)) allowed.ethnicity = ethnicity;

  const keys = Object.keys(allowed);
  if (keys.length > 0) {
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => allowed[k]);
    values.push(auth.userId);
    await context.env.DB.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).bind(...values).run();
  }

  const user = await loadCurrentUser(context.env, auth.userId);
  return json({ user });
}
