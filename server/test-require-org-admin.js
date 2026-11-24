import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { pool, migrate } from './db.js';
import { issueSession, SESSION_COOKIE } from './auth.js';
import { requireAuth, requireOrgAdmin } from './middleware-auth.js';

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

async function seed(suffix) {
  const orgSlug = `roa-test-${suffix}`;
  const memberEmail = `roa-member-${suffix}@example.com`;
  const adminEmail = `roa-admin-${suffix}@example.com`;

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

test('GET /probe without session cookie -> 401 from requireAuth', async () => {
  await seed('no-session');
  const res = await getRequest('/probe');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'not authenticated');
});

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

test('GET /probe with admin session -> 200 and pinned least-data currentUser', async () => {
  const { org, admin } = await seed('admin-pass');
  const cookie = await sessionCookie(admin, org);

  const res = await getRequest('/probe', { cookie });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const keys = Object.keys(body.currentUser).sort();
  assert.deepEqual(
    keys,
    ['id', 'org_id', 'org_name', 'org_slug', 'role'],
    `currentUser should expose only the least-data shape, got: ${JSON.stringify(keys)}`,
  );

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

test('GET /probe with stale session (user deleted) -> 401 session no longer valid', async () => {
  const { org, admin } = await seed('stale');
  const cookie = await sessionCookie(admin, org);

  await pool.query('DELETE FROM users WHERE id = $1', [admin.id]);

  const res = await getRequest('/probe', { cookie });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'session no longer valid');
});

test('GET /probe-bare (no requireAuth upstream) -> 401 defensive', async () => {
  const res = await getRequest('/probe-bare');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'not authenticated');
});
