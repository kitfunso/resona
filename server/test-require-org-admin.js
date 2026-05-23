import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { pool, migrate } from './db.js';
import { issueSession, SESSION_COOKIE } from './auth.js';
import { requireAuth, requireOrgAdmin } from './middleware-auth.js';

// Two probe routes:
//   /probe        : composed correctly: requireAuth -> requireOrgAdmin -> handler
//   /probe-bare   : DELIBERATELY without requireAuth, so we can exercise the
//                   defensive `if (!req.auth?.userId)` branch in requireOrgAdmin.
//
// No cookie-parser middleware here: requireAuth's extractCookie fallback parses
// req.headers.cookie directly when req.cookies isn't populated.
function buildProbeApp() {
  const app = express();
  app.get('/probe', requireAuth, requireOrgAdmin, (req, res) => {
    res.json({ ok: true, currentUser: req.currentUser });
  });
  app.get('/probe-bare', requireOrgAdmin, (req, res) => {
    res.json({ ok: true });
  });
  return app;
}

let server;
let baseUrl;

test.before(async () => {
  await migrate();
  const app = buildProbeApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// Seeds one org with a member + admin user pair, suffixed so cases don't collide.
// Mirrors the seed(suffix) pattern in test-admin-endpoints.js.
async function seed(suffix) {
  const orgSlug = `roa-test-${suffix}`;
  const memberEmail = `roa-member-${suffix}@example.com`;
  const adminEmail = `roa-admin-${suffix}@example.com`;

  // Clean any residue.
  await pool.query(
    `DELETE FROM role_grants WHERE user_id IN (
       SELECT id FROM users WHERE lower(email) IN ($1, $2)
     )`,
    [memberEmail, adminEmail],
  );

  const { rows: orgRows } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, slug, name`,
    [orgSlug, 'ROA Test Org'],
  );
  const org = orgRows[0];

  async function upsertUser(email, role) {
    await pool.query(
      `INSERT INTO users (org_id, email, role) VALUES ($1, lower($2), $3)
         ON CONFLICT (lower(email)) DO UPDATE SET org_id = EXCLUDED.org_id, role = EXCLUDED.role`,
      [org.id, email, role],
    );
    const { rows } = await pool.query(
      'SELECT id, role FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    return rows[0];
  }

  const member = await upsertUser(memberEmail, 'member');
  const admin = await upsertUser(adminEmail, 'admin');
  return { org, member: { ...member, email: memberEmail }, admin: { ...admin, email: adminEmail } };
}

function getRequest(path, { cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${path}`, { method: 'GET', headers });
}

async function sessionCookie(user, org) {
  const token = await issueSession({ userId: user.id, orgId: org.id });
  return `${SESSION_COOKIE}=${token}`;
}

// Captures console.info calls for the duration of `fn`. Restores the original
// console.info on completion (including on throw).
async function captureConsoleInfo(fn) {
  const captured = [];
  const original = console.info;
  console.info = (...args) => {
    captured.push(args.join(' '));
  };
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return captured;
}

// --- Case 1: no session cookie -> 401 from requireAuth (never reaches requireOrgAdmin).

test('GET /probe without session cookie -> 401 from requireAuth', async () => {
  await seed('no-session');
  const res = await getRequest('/probe');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'not authenticated');
});

// --- Case 2: member session -> 403 with [admin-deny] audit log line.

test('GET /probe with member session -> 403 and audit log line', async () => {
  const { org, member } = await seed('member-deny');
  const cookie = await sessionCookie(member, org);

  let res;
  const logs = await captureConsoleInfo(async () => {
    res = await getRequest('/probe', { cookie });
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'forbidden');

  // Audit line: anchored on '[admin-deny]', user= matches the seeded member id
  // (a real UUID, not the literal '<uuid>' placeholder), role=member, path=GET /probe.
  const denyLine = logs.find((line) => line.startsWith('[admin-deny]'));
  assert.ok(denyLine, `expected an [admin-deny] line, got: ${JSON.stringify(logs)}`);
  assert.ok(
    denyLine.includes(`user=${member.id}`),
    `audit line should reference seeded member id, got: ${denyLine}`,
  );
  assert.ok(denyLine.includes('role=member'), `audit line role=member, got: ${denyLine}`);
  assert.ok(
    denyLine.includes('path=GET /probe'),
    `audit line should include path=GET /probe, got: ${denyLine}`,
  );
});

// --- Case 3: admin session -> 200 with pinned least-data req.currentUser.

test('GET /probe with admin session -> 200 and pinned least-data currentUser', async () => {
  const { org, admin } = await seed('admin-pass');
  const cookie = await sessionCookie(admin, org);

  const res = await getRequest('/probe', { cookie });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  // Shape pinned: exactly these five keys, no special-category fields.
  const keys = Object.keys(body.currentUser).sort();
  assert.deepEqual(
    keys,
    ['id', 'org_id', 'org_name', 'org_slug', 'role'],
    `currentUser should expose only the least-data shape, got: ${JSON.stringify(keys)}`,
  );

  // Negative-assertion: confirm the special-category fields loadCurrentUser
  // returns are NOT leaking through. Art 5(1)(c) data minimisation.
  for (const forbidden of ['dob', 'height_cm', 'sex', 'ethnicity', 'email', 'name']) {
    assert.equal(
      body.currentUser[forbidden],
      undefined,
      `${forbidden} should NOT be on req.currentUser (special-category leak)`,
    );
  }

  assert.equal(body.currentUser.role, 'admin');
  assert.equal(body.currentUser.id, admin.id);
  assert.equal(body.currentUser.org_id, org.id);
  assert.equal(body.currentUser.org_slug, org.slug);
});

// --- Case 4: stale session (user deleted post-mint) -> 401 'session no longer valid'.
// JWTs are self-contained (server/auth.js::verifySession does not re-query users),
// so the cookie still verifies after DELETE FROM users, and loadCurrentUser
// returns null, exercising the stale-session branch.

test('GET /probe with stale session (user deleted) -> 401 session no longer valid', async () => {
  const { org, admin } = await seed('stale');
  const cookie = await sessionCookie(admin, org);

  // Delete the user mid-session. role_grants and check_ins cascade via FK.
  await pool.query('DELETE FROM users WHERE id = $1', [admin.id]);

  const res = await getRequest('/probe', { cookie });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'session no longer valid');
});

// --- Case 5: defensive. requireOrgAdmin mounted without requireAuth -> 401.

test('GET /probe-bare (no requireAuth upstream) -> 401 defensive', async () => {
  // No need to seed; the defensive branch fires before any DB read.
  const res = await getRequest('/probe-bare');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'not authenticated');
});
