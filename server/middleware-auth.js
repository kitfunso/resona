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

// requireOrgAdmin: session-based admin gate for Phase B aggregate routes.
//
// Must be composed AFTER requireAuth: `app.get('/x', requireAuth, requireOrgAdmin, handler)`.
// Role check only; org_id tenant scoping is each handler's responsibility
// (every aggregate read must `WHERE org_id = req.currentUser.org_id`).
//
// On success, attaches `req.currentUser` pinned to the least-data shape
// {id, role, org_id, org_slug, org_name}. The special-category fields
// loadCurrentUser returns (dob, height_cm, sex, ethnicity, email, name) are
// deliberately NOT propagated, per UK GDPR Art 5(1)(c) data minimisation.
//
// Failure modes:
//  - req.auth missing (mounted without requireAuth)  -> 401 'not authenticated'
//  - DB error loading the user                        -> next(err) for the platform error path
//  - user row deleted post-mint (stale 30d session)   -> 401 'session no longer valid'
//  - role !== 'admin'                                 -> 403 'forbidden' + console.info '[admin-deny] ...'
//
// The 403 audit line is the Art 5(2) accountability surface for Article 9
// special-category infrastructure. Phase A established the pattern with
// `[role-grant] ...` on the grant authority hop; this is its read-side mirror.
export async function requireOrgAdmin(req, res, next) {
  if (!req.auth?.userId) {
    return res.status(401).json({ error: 'not authenticated' });
  }

  let user;
  try {
    user = await loadCurrentUser(req.auth.userId);
  } catch (err) {
    // Match server/index.js convention: every handler catches DB errors with
    // a generic 500 instead of next(err). The app does not register a global
    // Express error handler, so next(err) would expose stack traces in dev.
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
