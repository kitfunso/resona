import { verifySession, SESSION_COOKIE } from './auth.js';
import { pool } from './db.js';

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE] ?? extractCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    const { userId, orgId } = await verifySession(token);
    req.auth = { userId, orgId };
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid session' });
  }
}

function extractCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function loadCurrentUser(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.dob, u.height_cm, u.sex, u.ethnicity,
            o.id AS org_id, o.slug AS org_slug, o.name AS org_name
       FROM users u JOIN orgs o ON o.id = u.org_id
       WHERE u.id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}
