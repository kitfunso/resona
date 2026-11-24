import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { migrate, pool } from './db.js';
import { requestCode, verifyCode, issueSession, SESSION_COOKIE, SESSION_TTL_SEC_OUT } from './auth.js';
import { requireAuth, requireOrgAdmin, loadCurrentUser } from './middleware-auth.js';
import { orgParticipation, modalityDistribution, SUPPRESSED, MIN_GROUP } from './aggregates.js';
import { MODEL, askGLMJsonWithRetry, isConfigured } from './llm.js';
import {
  atsFlags,
  classifierFallback,
  personalReportFallback,
  neuroReportFallback,
  heartReportFallback,
  scrubReport,
} from './reports.js';
import {
  PERSONAL_REPORT_SYSTEM,
  NEURO_REPORT_SYSTEM,
  HEART_REPORT_SYSTEM,
  buildPersonalReportUserMessage,
  buildNeuroReportUserMessage,
  buildHeartReportUserMessage,
  buildDemographics,
} from './prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const authRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

const authVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts; try again later' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Disallowed origin: omit the CORS header and let the browser enforce the
    // policy. Do NOT throw — throwing surfaces as a 500 for every request that
    // carries an Origin, including same-origin `crossorigin` ES-module asset
    // loads, which blanks the whole app behind a proxy/tunnel.
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    product: 'Resona',
    modules: ['Breath', 'Neuro', 'Heart'],
    tagline: 'Every body has a rhythm.',
    glm: { model: MODEL, configured: isConfigured() },
    db: 'postgres',
    demo: process.env.DEMO_MODE === 'true',
    uptime_s: Math.round(process.uptime()),
  });
});

app.post('/api/analyze-neuro', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex) {
    return res.status(400).json({ error: 'profile incomplete; PATCH /api/me first' });
  }

  const { tremor, gait } = req.body || {};
  if (!tremor && !gait) {
    return res.status(400).json({ error: 'need at least one of tremor or gait' });
  }

  let report;
  let source = 'ai';
  try {
    report = await askGLMJsonWithRetry(
      [
        { role: 'system', content: NEURO_REPORT_SYSTEM },
        { role: 'user', content: buildNeuroReportUserMessage({ tremor, gait, demographics }) },
      ],
      { tag: 'neuro-report', temperature: 0.8, max_tokens: 2000 },
    );
    if (!report?.headline || !Array.isArray(report?.actions)) {
      report = neuroReportFallback({ tremor, gait });
      source = 'fallback';
    }
  } catch (err) {
    console.warn(`[analyze-neuro] failed: ${err.message}`);
    report = neuroReportFallback({ tremor, gait });
    source = 'fallback';
  }
  report.source = source;
  scrubReport(report);
  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'motion', $3::jsonb)`,
      [req.auth.userId, user.org_id, JSON.stringify({ tremor: req.body.tremor, gait: req.body.gait, neuroReport: report })],
    );
  } catch (err) {
    console.error('[analyze-neuro] check_ins persist failed:', err.message);
  }
  res.json({ ok: true, report });
});

app.post('/api/analyze-heart', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex) {
    return res.status(400).json({ error: 'profile incomplete; PATCH /api/me first' });
  }

  const { heart } = req.body || {};
  if (!heart || typeof heart !== 'object') {
    return res.status(400).json({ error: 'missing heart payload' });
  }
  if (!Number.isFinite(heart.hrBpm)) {
    return res.status(400).json({ error: 'heart.hrBpm must be a finite number' });
  }

  if (heart.quality?.grade === 'poor') {
    return res.json({
      ok: false,
      coaching: {
        message:
          'We could not read a clean pulse from your camera. Move into brighter, even light, hold still with your face centred in the oval, and try again.',
      },
    });
  }

  let report;
  let source = 'ai';
  try {
    report = await askGLMJsonWithRetry(
      [
        { role: 'system', content: HEART_REPORT_SYSTEM },
        { role: 'user', content: buildHeartReportUserMessage({ heart, demographics }) },
      ],
      { tag: 'heart-report', temperature: 0.8, max_tokens: 2000 },
    );
    if (!report?.headline || !Array.isArray(report?.actions)) {
      report = heartReportFallback({ heart });
      source = 'fallback';
    }
  } catch (err) {
    console.warn(`[analyze-heart] failed: ${err.message}`);
    report = heartReportFallback({ heart });
    source = 'fallback';
  }
  report.source = source;
  scrubReport(report);
  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'heart', $3::jsonb)`,
      [req.auth.userId, user.org_id, JSON.stringify({ heart: req.body.heart, heartReport: report })],
    );
  } catch (err) {
    console.error('[analyze-heart] check_ins persist failed:', err.message);
  }
  res.json({ ok: true, report });
});

app.post('/api/analyze-blow', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex || !demographics.heightCm) {
    return res.status(400).json({ error: 'profile incomplete; PATCH /api/me first' });
  }

  const { features, estimate, sessionId } = req.body || {};
  if (!features || !estimate) {
    return res.status(400).json({ error: 'missing features or estimate' });
  }
  if (
    !Number.isFinite(estimate.fev1) ||
    !Number.isFinite(estimate.fvc) ||
    !Number.isFinite(estimate.pef) ||
    !Number.isFinite(estimate.effortScore) ||
    !estimate.percentPredicted ||
    !Number.isFinite(estimate.percentPredicted.fev1)
  ) {
    return res.status(400).json({ error: 'malformed estimate' });
  }

  const classification = classifierFallback({ features, estimate });
  if (!classification?.valid) {
    return res.json({
      valid: false,
      reason: classification?.reason || 'unknown',
      coachingMessage: classification?.coaching_message || 'That did not look like a valid blow. Try again.',
    });
  }

  const flags = atsFlags(features);

  const flagged = estimate.percentPredicted.fev1 < 80;

  let personalReport;
  let personalReportSource = 'ai';
  try {
    personalReport = await askGLMJsonWithRetry(
      [
        { role: 'system', content: PERSONAL_REPORT_SYSTEM },
        { role: 'user', content: buildPersonalReportUserMessage({ estimate, demographics, atsFlags: flags }) },
      ],
      { tag: 'personal-report', temperature: 0.8, max_tokens: 2000 },
    );
    if (!personalReport?.headline) {
      personalReport = personalReportFallback({ estimate });
      personalReportSource = 'fallback';
    }
  } catch (err) {
    console.warn(`[analyze-blow] personal report failed: ${err.message}`);
    personalReport = personalReportFallback({ estimate });
    personalReportSource = 'fallback';
  }
  personalReport.source = personalReportSource;

  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'breath', $3::jsonb)`,
      [req.auth.userId, user.org_id, JSON.stringify({ features: req.body.features, estimate, atsFlags: flags, personalReport })],
    );
  } catch (err) {
    console.error('[analyze-blow] check_ins persist failed:', err.message);
  }
  res.json({
    valid: true,
    classification,
    atsFlags: classification.atsFlags || [],
    personalReport,
  });
});

app.post('/api/auth/request', authRequestLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  if (!email.includes('@')) return res.status(400).json({ error: 'invalid email' });
  try {
    await requestCode(email);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/request]', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/api/auth/verify', authVerifyLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'invalid input' });
  }
  try {
    const session = await verifyCode(email, code);
    const token = await issueSession({ userId: session.userId, orgId: session.orgId });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SEC_OUT * 1000,
      path: '/',
    });
    res.json({ ok: true, email: session.email });
  } catch (err) {
    res.status(401).json({ error: 'invalid or expired code' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/auth/guest', authRequestLimiter, async (req, res) => {
  if (process.env.DEMO_MODE !== 'true') return res.status(404).json({ error: 'not found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: orgs } = await client.query(
      `INSERT INTO orgs (slug, name) VALUES ('demo', 'Demo')
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`,
    );
    const guestEmail = `guest-${crypto.randomUUID()}@demo.local`;
    const { rows: users } = await client.query(
      'INSERT INTO users (org_id, email) VALUES ($1, $2) RETURNING id, org_id',
      [orgs[0].id, guestEmail],
    );
    await client.query('COMMIT');
    const token = await issueSession({ userId: users[0].id, orgId: users[0].org_id });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SEC_OUT * 1000,
      path: '/',
    });
    res.json({ ok: true, guest: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth/guest]', err);
    res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user });
});

const SEX_VALUES = new Set(['male', 'female', 'intersex', 'other', 'prefer-not-to-say']);
const ETHNICITY_VALUES = new Set([
  'Caucasian', 'African', 'African-American', 'Hispanic', 'East Asian',
  'South Asian', 'Southeast Asian', 'Middle Eastern', 'Indigenous', 'Mixed', 'Other',
]);

const ME_CHECK_INS_DEFAULT_LIMIT = 50;
const ME_CHECK_INS_MAX_LIMIT = 200;

app.patch('/api/me', requireAuth, async (req, res) => {
  const { name, dob, heightCm, sex, ethnicity } = req.body ?? {};
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
  if (keys.length === 0) return res.json({ user: await loadCurrentUser(req.auth.userId) });
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => allowed[k]);
  values.push(req.auth.userId);
  try {
    await pool.query(`UPDATE users SET ${setClause} WHERE id = $${values.length}`, values);
  } catch (err) {
    if (err.code === '22008' || err.code === '22007') {
      return res.status(400).json({ error: 'invalid date' });
    }
    throw err;
  }
  res.json({ user: await loadCurrentUser(req.auth.userId) });
});

app.get('/api/me/check-ins', requireAuth, async (req, res) => {
  const rawLimit = req.query.limit;
  const parsed = Number.parseInt(rawLimit, 10);
  let limit;
  if (!Number.isFinite(parsed) || parsed < 1) {
    limit = ME_CHECK_INS_DEFAULT_LIMIT;
  } else if (parsed > ME_CHECK_INS_MAX_LIMIT) {
    limit = ME_CHECK_INS_MAX_LIMIT;
  } else {
    limit = parsed;
  }
  try {
    const { rows } = await pool.query(
      `SELECT
         id,
         kind,
         created_at,
         CASE kind
           WHEN 'breath' THEN payload->'personalReport'->>'headline'
           WHEN 'motion' THEN payload->'neuroReport'->>'headline'
           WHEN 'heart'  THEN payload->'heartReport'->>'headline'
           ELSE NULL
         END AS headline
       FROM check_ins
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.auth.userId, limit],
    );
    const checkIns = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      headline: row.headline,
    }));
    res.json({
      checkIns,
      limit,
      truncated: checkIns.length === limit,
    });
  } catch (err) {
    console.error('[me/check-ins]', err);
    res.status(500).json({ error: 'failed' });
  }
});

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (ADMIN_TOKEN && ADMIN_TOKEN.length < 32) {
  throw new Error('ADMIN_TOKEN must be at least 32 chars');
}
const ADMIN_TOKEN_BUF = ADMIN_TOKEN ? Buffer.from(ADMIN_TOKEN) : null;

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN_BUF) return res.status(503).json({ error: 'admin disabled' });
  const provided = req.headers['x-admin-token'];
  if (typeof provided !== 'string') return res.status(401).json({ error: 'unauthorized' });
  const providedBuf = Buffer.from(provided);
  if (providedBuf.length !== ADMIN_TOKEN_BUF.length) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!crypto.timingSafeEqual(providedBuf, ADMIN_TOKEN_BUF)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/api/admin/orgs', adminLimiter, requireAdmin, async (req, res) => {
  const { slug, name, firstUserEmail } = req.body ?? {};
  if (typeof slug !== 'string' || !/^[a-z0-9-]{2,40}$/.test(slug)) {
    return res.status(400).json({ error: 'invalid slug (lowercase, digits, hyphens, 2-40 chars)' });
  }
  if (typeof name !== 'string' || name.length < 1) {
    return res.status(400).json({ error: 'invalid name' });
  }
  if (typeof firstUserEmail !== 'string' || !firstUserEmail.includes('@')) {
    return res.status(400).json({ error: 'invalid firstUserEmail' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: orgs } = await client.query(
      'INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id',
      [slug, name],
    );
    const { rows: users } = await client.query(
      'INSERT INTO users (org_id, email) VALUES ($1, lower($2)) RETURNING id, email',
      [orgs[0].id, firstUserEmail],
    );
    await client.query('COMMIT');
    res.json({ org: { id: orgs[0].id, slug, name }, firstUser: users[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'slug or email already exists' });
    console.error('[admin/orgs]', err);
    res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/users', adminLimiter, requireAdmin, async (req, res) => {
  const { orgSlug, email, role } = req.body ?? {};
  if (typeof orgSlug !== 'string' || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid input' });
  }
  const newRole = role === undefined ? 'member' : role;
  if (typeof newRole !== 'string' || !ROLE_VALUES.has(newRole)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  const { rows: orgs } = await pool.query('SELECT id FROM orgs WHERE slug = $1', [orgSlug]);
  if (orgs.length === 0) return res.status(404).json({ error: 'org not found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO users (org_id, email, role) VALUES ($1, lower($2), $3) RETURNING id, email, role',
      [orgs[0].id, email, newRole],
    );
    if (newRole === 'admin') {
      await client.query(
        `INSERT INTO role_grants (user_id, granted_role, granted_by)
         VALUES ($1, 'admin', 'admin_token')`,
        [rows[0].id],
      );
    }
    await client.query('COMMIT');
    res.json({ user: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'email already exists' });
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
});

const ROLE_VALUES = new Set(['member', 'admin']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEAM_NAME_RE = /^[A-Za-z0-9 .,&'\-]+$/;
function isValidTeamName(name) {
  return typeof name === 'string'
    && name.length >= 1
    && name.length <= 80
    && TEAM_NAME_RE.test(name);
}

app.post('/api/admin/users/:id/role', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const { role } = req.body ?? {};
  if (typeof role !== 'string' || !ROLE_VALUES.has(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  const orgId = req.currentUser.org_id;
  const actorId = req.currentUser.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM orgs WHERE id = $1 FOR UPDATE', [orgId]);
    const { rows: existing } = await client.query(
      'SELECT id, email, role FROM users WHERE id = $1 AND org_id = $2',
      [id, orgId],
    );
    if (existing.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user not found' });
    }
    const current = existing[0];
    if (current.role === role) {
      await client.query('ROLLBACK');
      return res.json({ user: { id: current.id, email: current.email, role: current.role } });
    }
    if (current.role === 'admin' && role !== 'admin') {
      const { rows: admins } = await client.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin'`,
        [orgId],
      );
      if (admins[0].n <= 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'cannot remove the last admin' });
      }
    }
    await client.query('UPDATE users SET role = $1 WHERE id = $2 AND org_id = $3', [role, id, orgId]);
    await client.query(
      `INSERT INTO role_grants (user_id, granted_role, granted_by)
       VALUES ($1, $2, $3)`,
      [id, role, `session:${actorId}`],
    );
    await client.query('COMMIT');
    console.info(`[role-grant] user=${id} org=${orgId} role=${role} by=session:${actorId}`);
    res.json({ user: { id: current.id, email: current.email, role } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/role]', err);
    res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/users/:id', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const orgId = req.currentUser.org_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM orgs WHERE id = $1 FOR UPDATE', [orgId]);
    const { rows: target } = await client.query(
      'SELECT role FROM users WHERE id = $1 AND org_id = $2',
      [id, orgId],
    );
    if (target.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user not found' });
    }
    if (target[0].role === 'admin') {
      const { rows: admins } = await client.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin'`,
        [orgId],
      );
      if (admins[0].n <= 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'cannot erase the last admin' });
      }
    }
    await client.query('DELETE FROM users WHERE id = $1 AND org_id = $2', [id, orgId]);
    await client.query('COMMIT');
    console.info(`[user-erase] actor=${req.currentUser.id} org=${orgId} deleted=${id}`);
    res.json({ ok: true, deleted: id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/delete-user]', err);
    res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/teams', adminLimiter, requireAdmin, async (req, res) => {
  const { orgSlug, name } = req.body ?? {};
  if (typeof orgSlug !== 'string') {
    return res.status(400).json({ error: 'invalid input' });
  }
  if (!isValidTeamName(name)) {
    return res.status(400).json({ error: 'invalid name' });
  }
  const { rows: orgs } = await pool.query('SELECT id FROM orgs WHERE slug = $1', [orgSlug]);
  if (orgs.length === 0) return res.status(404).json({ error: 'org not found' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO teams (org_id, name) VALUES ($1, $2)
       RETURNING id, org_id, name, created_at`,
      [orgs[0].id, name],
    );
    res.status(201).json({ team: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'team name already exists in this org' });
    }
    console.error('[admin/teams]', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/api/admin/teams/:id/members', adminLimiter, requireAdmin, async (req, res) => {
  const { id: teamId } = req.params;
  if (!UUID_RE.test(teamId)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const { userEmail } = req.body ?? {};
  if (typeof userEmail !== 'string' || !userEmail.includes('@')) {
    return res.status(400).json({ error: 'invalid input' });
  }
  const { rows: teams } = await pool.query(
    'SELECT id, org_id FROM teams WHERE id = $1',
    [teamId],
  );
  if (teams.length === 0) return res.status(404).json({ error: 'team not found' });
  const team = teams[0];
  const { rows: users } = await pool.query(
    'SELECT id, org_id FROM users WHERE lower(email) = lower($1)',
    [userEmail],
  );
  if (users.length === 0) return res.status(404).json({ error: 'user not found' });
  const user = users[0];
  if (user.org_id !== team.org_id) {
    return res.status(400).json({ error: 'cross-org add' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO team_memberships (user_id, team_id, org_id)
       VALUES ($1, $2, $3)
       RETURNING user_id, team_id, org_id, created_at`,
      [user.id, team.id, team.org_id],
    );
    res.status(201).json({ membership: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'already a member' });
    if (err.code === '23503') return res.status(400).json({ error: 'cross-org add' });
    console.error('[admin/teams/members]', err);
    res.status(500).json({ error: 'failed' });
  }
});

const DAYS_MIN = 1;
const DAYS_MAX = 365;
const DAYS_DEFAULT = 30;
function parseDays(rawValue) {
  if (rawValue === undefined) return { value: DAYS_DEFAULT };
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return { error: 'days must be integer in [1,365]' };
  }
  if (!/^(0|[1-9][0-9]*)$/.test(rawValue)) {
    return { error: 'days must be integer in [1,365]' };
  }
  const n = Number(rawValue);
  if (n < DAYS_MIN || n > DAYS_MAX) {
    return { error: 'days must be integer in [1,365]' };
  }
  return { value: n };
}

function adminAuditRead(req) {
  console.info(
    `[admin-read] user=${req.currentUser.id} org=${req.currentUser.org_id} path=${req.method} ${req.originalUrl}`,
  );
}

app.get('/api/admin/overview', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  const days = parseDays(req.query.days);
  if (days.error) return res.status(400).json({ error: days.error });
  const orgId = req.currentUser.org_id;
  try {
    const [participation, breath, motion, heart] = await Promise.all([
      orgParticipation(orgId, days.value),
      modalityDistribution(orgId, 'breath', days.value),
      modalityDistribution(orgId, 'motion', days.value),
      modalityDistribution(orgId, 'heart',  days.value),
    ]);
    adminAuditRead(req);
    res.json({ participation, distributions: { breath, motion, heart } });
  } catch (err) {
    console.error('[admin/overview]', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/api/admin/teams', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = req.currentUser.org_id;
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name,
              (SELECT COUNT(*)::int FROM team_memberships
                WHERE team_id = t.id AND org_id = t.org_id) AS member_count
         FROM teams t
        WHERE t.org_id = $1
        ORDER BY lower(t.name) ASC`,
      [orgId],
    );
    const teams = rows.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: row.member_count < MIN_GROUP
        ? SUPPRESSED
        : row.member_count,
    }));
    adminAuditRead(req);
    res.json({ teams });
  } catch (err) {
    console.error('[admin/teams]', err);
    res.status(500).json({ error: 'failed' });
  }
});

const NOT_FOUND_BODY = { error: 'not found' };
app.get('/api/admin/teams/:id/overview', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  const days = parseDays(req.query.days);
  if (days.error) return res.status(400).json({ error: days.error });

  const teamId = req.params.id;
  if (!UUID_RE.test(teamId)) {
    return res.status(404).json(NOT_FOUND_BODY);
  }
  const orgId = req.currentUser.org_id;
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM teams WHERE id = $1 AND org_id = $2`,
      [teamId, orgId],
    );
    if (rows.length === 0) {
      return res.status(404).json(NOT_FOUND_BODY);
    }
    const team = rows[0];

    const [breath, motion, heart] = await Promise.all([
      modalityDistribution(orgId, 'breath', days.value, { teamId }),
      modalityDistribution(orgId, 'motion', days.value, { teamId }),
      modalityDistribution(orgId, 'heart',  days.value, { teamId }),
    ]);
    adminAuditRead(req);
    res.json({ team: { id: team.id, name: team.name }, distributions: { breath, motion, heart } });
  } catch (err) {
    console.error('[admin/teams/:id/overview]', err);
    res.status(500).json({ error: 'failed' });
  }
});

const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const server = http.createServer(app);

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`[Resona] backend listening on :${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[Resona] migration failed, aborting boot:', err);
      process.exit(1);
    });
}
