import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from './index.js';
import { pool, migrate } from './db.js';
import { issueSession, SESSION_COOKIE } from './auth.js';

// Tests for DELETE /api/admin/users/:id (PRIV-2 right-to-erasure).
// Session-RBAC route: an org admin may erase users only within their own org;
// the ON DELETE CASCADE chain must purge the user's check_ins + memberships.

let server;
let baseUrl;

test.before(async () => {
  // Skip adminLimiter (per-IP cap trips on same-process throughput). The
  // limiter's skip predicate is () => NODE_ENV === 'test', re-evaluated per
  // request. Production never sets NODE_ENV=test.
  process.env.NODE_ENV = 'test';
  await migrate();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function seedOrg(slug, name) {
  // Clean dependent rows so reruns are isolated. teams are org-scoped (not
  // user-scoped), so they do NOT cascade from the users delete; drop them and
  // their memberships explicitly or a second run collides on teams_org_name_idx.
  await pool.query(`DELETE FROM team_memberships WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [slug]);
  await pool.query(`DELETE FROM teams WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [slug]);
  await pool.query(
    `DELETE FROM users WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`,
    [slug],
  );
  const { rows } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [slug, name],
  );
  return rows[0].id;
}

async function addUser(orgId, email, role = 'member') {
  const { rows } = await pool.query(
    `INSERT INTO users (org_id, email, role) VALUES ($1, lower($2), $3) RETURNING id`,
    [orgId, email, role],
  );
  return rows[0].id;
}

async function cookie(userId, orgId) {
  return `${SESSION_COOKIE}=${await issueSession({ userId, orgId })}`;
}

async function del(path, c) {
  const headers = {};
  if (c) headers.Cookie = c;
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
  const raw = await res.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { /* leave null */ }
  return { status: res.status, body };
}

test('DELETE /api/admin/users/:id without session -> 401', async () => {
  const orgId = await seedOrg('del-noauth', 'Del NoAuth');
  const uid = await addUser(orgId, 'del-noauth@example.com');
  const res = await del(`/api/admin/users/${uid}`);
  assert.equal(res.status, 401);
  const u = await pool.query('SELECT 1 FROM users WHERE id = $1', [uid]);
  assert.equal(u.rowCount, 1, 'unauthenticated request must not delete');
});

test('DELETE with member session -> 403 (requireOrgAdmin gate)', async () => {
  const orgId = await seedOrg('del-member-gate', 'Del Member Gate');
  const memberId = await addUser(orgId, 'del-mg@example.com', 'member');
  const targetId = await addUser(orgId, 'del-mg-target@example.com', 'member');
  const res = await del(`/api/admin/users/${targetId}`, await cookie(memberId, orgId));
  assert.equal(res.status, 403);
  const u = await pool.query('SELECT 1 FROM users WHERE id = $1', [targetId]);
  assert.equal(u.rowCount, 1, 'a member must not be able to erase a user');
});

test('DELETE malformed :id -> 400', async () => {
  const orgId = await seedOrg('del-badid', 'Del BadId');
  const adminId = await addUser(orgId, 'del-badid-admin@example.com', 'admin');
  const res = await del('/api/admin/users/not-a-uuid', await cookie(adminId, orgId));
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid id');
});

test('admin erases a user in their own org: CASCADE purges check_ins + memberships', async () => {
  const orgId = await seedOrg('del-own', 'Del Own');
  const adminId = await addUser(orgId, 'del-admin@example.com', 'admin');
  const memberId = await addUser(orgId, 'del-member@example.com', 'member');
  const { rows: t } = await pool.query(
    `INSERT INTO teams (org_id, name) VALUES ($1, 'Erase Team') RETURNING id`,
    [orgId],
  );
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, org_id) VALUES ($1, $2, $3)`,
    [memberId, t[0].id, orgId],
  );
  await pool.query(
    `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'heart', '{}'::jsonb)`,
    [memberId, orgId],
  );

  const res = await del(`/api/admin/users/${memberId}`, await cookie(adminId, orgId));
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, memberId);

  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [memberId])).rowCount, 0, 'user row purged');
  assert.equal((await pool.query('SELECT 1 FROM check_ins WHERE user_id = $1', [memberId])).rowCount, 0, 'check_ins cascade-purged');
  assert.equal((await pool.query('SELECT 1 FROM team_memberships WHERE user_id = $1', [memberId])).rowCount, 0, 'team_memberships cascade-purged');
});

test('admin cannot erase a user in another org -> 404, target survives', async () => {
  const orgA = await seedOrg('del-a', 'Del A');
  const orgB = await seedOrg('del-b', 'Del B');
  const adminA = await addUser(orgA, 'del-a-admin@example.com', 'admin');
  const victimB = await addUser(orgB, 'del-b-victim@example.com', 'member');
  const res = await del(`/api/admin/users/${victimB}`, await cookie(adminA, orgA));
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'user not found');
  const u = await pool.query('SELECT 1 FROM users WHERE id = $1', [victimB]);
  assert.equal(u.rowCount, 1, 'cross-org target must survive');
});

test('cannot erase the org last admin (self) -> 409 (SEC-1 last-admin guard)', async () => {
  const orgId = await seedOrg('del-lastadmin', 'Del LastAdmin');
  const adminId = await addUser(orgId, 'del-lastadmin@example.com', 'admin');
  const res = await del(`/api/admin/users/${adminId}`, await cookie(adminId, orgId));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'cannot erase the last admin');
  const u = await pool.query('SELECT 1 FROM users WHERE id = $1', [adminId]);
  assert.equal(u.rowCount, 1, 'last admin must survive');
});

test('can erase an admin when another admin remains', async () => {
  const orgId = await seedOrg('del-twoadmin', 'Del TwoAdmin');
  const a1 = await addUser(orgId, 'del-twoadmin-1@example.com', 'admin');
  const a2 = await addUser(orgId, 'del-twoadmin-2@example.com', 'admin');
  const res = await del(`/api/admin/users/${a2}`, await cookie(a1, orgId));
  assert.equal(res.status, 200);
  const u = await pool.query('SELECT 1 FROM users WHERE id = $1', [a2]);
  assert.equal(u.rowCount, 0, 'second admin erased while one remains');
});
