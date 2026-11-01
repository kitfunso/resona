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
    `SELECT u.id, u.email, u.name, u.dob, u.height_cm, u.sex, u.ethnicity, u.role,
            o.id AS org_id, o.slug AS org_slug, o.name AS org_name
       FROM users u JOIN orgs o ON o.id = u.org_id
       WHERE u.id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

// Session admin gate; must run AFTER requireAuth. Attaches req.currentUser
// (minimal shape, no PII) or 401/403 per failure mode; full contract and
// the audit-log rationale are in docs/ARCHITECTURE.md.
export async function requireOrgAdmin(req, res, next) {
  if (!req.auth?.userId) {
    return res.status(401).json({ error: 'not authenticated' });
  }

  let user;
  try {
    user = await loadCurrentUser(req.auth.userId);
  } catch (err) {
    // Generic 500, not next(err): no global error handler is registered, so
    // next(err) would leak stack traces in dev (matches server/index.js).
    console.error('[requireOrgAdmin] loadCurrentUser failed:', err);
    return res.status(500).json({ error: 'failed' });
  }

  if (!user) {
    return res.status(401).json({ error: 'session no longer valid' });
  }

  if (user.role !== 'admin') {
    console.info(
      `[admin-deny] user=${user.id} role=${user.role} path=${req.method} ${req.originalUrl}`,
    );
    return res.status(403).json({ error: 'forbidden' });
  }

  req.currentUser = {
    id: user.id,
    role: user.role,
    org_id: user.org_id,
    org_slug: user.org_slug,
    org_name: user.org_name,
  };
  next();
}
