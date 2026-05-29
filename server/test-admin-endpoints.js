import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from './index.js';
import { pool, migrate } from './db.js';
import { issueSession, SESSION_COOKIE } from './auth.js';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

let server;
let baseUrl;

test.before(async () => {
  // Disable adminLimiter for the suite: it hits 127.0.0.1 from one process at
  // high throughput. The limiter's skip predicate is () => NODE_ENV === 'test',
  // re-evaluated per request, so setting it here is sufficient (mirrors
  // test-aggregates.js). Production traffic never sets NODE_ENV=test.
  process.env.NODE_ENV = 'test';
  assert.ok(ADMIN_TOKEN && ADMIN_TOKEN.length >= 32, 'ADMIN_TOKEN must be set with length >= 32 for these tests');
  await migrate();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function req(method, urlPath, { body, adminToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminToken !== undefined) headers['x-admin-token'] = adminToken;
  return fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Session-cookie request helper for the RBAC role endpoint (SEC-1): /role is no
// longer token-gated, it requires an org-admin session.
function sreq(method, urlPath, { body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function adminCookie(userId, orgId) {
  return `${SESSION_COOKIE}=${await issueSession({ userId, orgId })}`;
}

async function makeOrgAdmin(userId) {
  await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
}

// Seeds two orgs, each with two users. Returns the ids the tests need.
// Idempotent: each call wipes the prior seed rows via ON CONFLICT + targeted
// deletes so the tests are independent of one another and of run order.
async function seed(suffix) {
  const orgASlug = `admin-test-a-${suffix}`;
  const orgBSlug = `admin-test-b-${suffix}`;
  const userA1Email = `a1-${suffix}@example.com`;
  const userA2Email = `a2-${suffix}@example.com`;
  const userB1Email = `b1-${suffix}@example.com`;
  const userB2Email = `b2-${suffix}@example.com`;

  // Clean any prior teams + memberships + role_grants tied to this suffix.
  await pool.query(
    `DELETE FROM team_memberships WHERE org_id IN (SELECT id FROM orgs WHERE slug IN ($1, $2))`,
    [orgASlug, orgBSlug],
  );
  await pool.query(
    `DELETE FROM teams WHERE org_id IN (SELECT id FROM orgs WHERE slug IN ($1, $2))`,
    [orgASlug, orgBSlug],
  );
  await pool.query(
    `DELETE FROM role_grants WHERE user_id IN (
       SELECT id FROM users WHERE lower(email) IN ($1, $2, $3, $4)
     )`,
    [userA1Email, userA2Email, userB1Email, userB2Email],
  );

  const { rows: orgARows } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgASlug, 'Org A'],
  );
  const { rows: orgBRows } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgBSlug, 'Org B'],
  );
  const orgAId = orgARows[0].id;
  const orgBId = orgBRows[0].id;

  async function upsertUser(orgId, email) {
    await pool.query(
      `INSERT INTO users (org_id, email) VALUES ($1, lower($2))
         ON CONFLICT (lower(email)) DO UPDATE SET org_id = EXCLUDED.org_id, role = 'member'`,
      [orgId, email],
    );
    const { rows } = await pool.query('SELECT id, role FROM users WHERE lower(email) = lower($1)', [email]);
    return rows[0];
  }
  const a1 = await upsertUser(orgAId, userA1Email);
  const a2 = await upsertUser(orgAId, userA2Email);
  const b1 = await upsertUser(orgBId, userB1Email);
  const b2 = await upsertUser(orgBId, userB2Email);
  return {
    orgA: { id: orgAId, slug: orgASlug },
    orgB: { id: orgBId, slug: orgBSlug },
    a1: { ...a1, email: userA1Email },
    a2: { ...a2, email: userA2Email },
    b1: { ...b1, email: userB1Email },
    b2: { ...b2, email: userB2Email },
  };
}

// Auth gating (SEC-1: /role is session-RBAC, not ADMIN_TOKEN) ----------------

test('POST /api/admin/users/:id/role without a session -> 401', async () => {
  const { a2 } = await seed('auth-missing');
  const res = await sreq('POST', `/api/admin/users/${a2.id}/role`, { body: { role: 'admin' } });
  assert.equal(res.status, 401);
});

test('POST /api/admin/users/:id/role with a member session -> 403', async () => {
  const { orgA, a1, a2 } = await seed('auth-member');
  // a1 is a plain member; requireOrgAdmin must reject before the handler runs.
  const res = await sreq('POST', `/api/admin/users/${a2.id}/role`, {
    body: { role: 'admin' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 403);
});

test('POST /api/admin/users/:id/role with the ADMIN_TOKEN (no session) -> 401', async () => {
  // The global token can no longer grant roles: only an org-admin session can.
  const { a2 } = await seed('auth-token-rejected');
  const res = await req('POST', `/api/admin/users/${a2.id}/role`, {
    body: { role: 'admin' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 401);
});

// POST /api/admin/users/:id/role --------------------------------------------

test('POST /role with invalid role -> 400', async () => {
  const { orgA, a1, a2 } = await seed('role-invalid');
  await makeOrgAdmin(a1.id);
  const res = await sreq('POST', `/api/admin/users/${a2.id}/role`, {
    body: { role: 'superuser' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid role');
});

test('POST /role for a missing user -> 404', async () => {
  const { orgA, a1 } = await seed('role-missing');
  await makeOrgAdmin(a1.id);
  // A well-formed UUID that doesn't exist in the org.
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const res = await sreq('POST', `/api/admin/users/${fakeId}/role`, {
    body: { role: 'admin' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'user not found');
});

test('POST /role with a malformed :id -> 400 (not a 500 from PG 22P02)', async () => {
  const { orgA, a1 } = await seed('role-badid');
  await makeOrgAdmin(a1.id);
  const res = await sreq('POST', '/api/admin/users/not-a-uuid/role', {
    body: { role: 'admin' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid id');
});

test('POST /teams/:id/members with a malformed :id -> 400', async () => {
  const res = await req('POST', '/api/admin/teams/not-a-uuid/members', {
    body: { userEmail: 'noone@example.com' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid id');
});

test('POST /role happy path: admin promotes a member, session:<actor> audit row', async () => {
  const { orgA, a1, a2 } = await seed('role-happy');
  await makeOrgAdmin(a1.id);
  const res = await sreq('POST', `/api/admin/users/${a2.id}/role`, {
    body: { role: 'admin' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.id, a2.id);
  assert.equal(user.role, 'admin');

  const { rows: userRows } = await pool.query('SELECT role FROM users WHERE id = $1', [a2.id]);
  assert.equal(userRows[0].role, 'admin');

  const { rows: grants } = await pool.query(
    'SELECT granted_role, granted_by FROM role_grants WHERE user_id = $1',
    [a2.id],
  );
  assert.equal(grants.length, 1, 'exactly one role_grants row');
  assert.equal(grants[0].granted_role, 'admin');
  assert.equal(grants[0].granted_by, `session:${a1.id}`, 'audit records the acting admin');
});

test('POST /role no-op when role unchanged: 200, no new audit row', async () => {
  const { orgA, a1, a2 } = await seed('role-noop');
  await makeOrgAdmin(a1.id);
  const cookie = await adminCookie(a1.id, orgA.id);
  // First call: promote a2 to admin, leaves one audit row.
  const r1 = await sreq('POST', `/api/admin/users/${a2.id}/role`, { body: { role: 'admin' }, cookie });
  assert.equal(r1.status, 200);
  const { rows: before } = await pool.query(
    'SELECT count(*)::int AS n FROM role_grants WHERE user_id = $1',
    [a2.id],
  );
  assert.equal(before[0].n, 1);
  // Second call with the same role: a no-op, no new audit row.
  const r2 = await sreq('POST', `/api/admin/users/${a2.id}/role`, { body: { role: 'admin' }, cookie });
  assert.equal(r2.status, 200);
  const { rows: after } = await pool.query(
    'SELECT count(*)::int AS n FROM role_grants WHERE user_id = $1',
    [a2.id],
  );
  assert.equal(after[0].n, 1, 'no-op must not insert another row');
});

test('POST /role cannot touch a user in another org -> 404 (SEC-1)', async () => {
  // An org-A admin must not flip a user in org B. org comes from the session,
  // not input, so b1 is invisible and stays a member.
  const { orgA, a1, b1 } = await seed('role-cross');
  await makeOrgAdmin(a1.id);
  const res = await sreq('POST', `/api/admin/users/${b1.id}/role`, {
    body: { role: 'admin' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'user not found');
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [b1.id]);
  assert.equal(rows[0].role, 'member', 'cross-org target must remain a member');
});

test('POST /role last-admin guard: demoting the org sole admin -> 409 (SEC-1)', async () => {
  const { orgA, a1 } = await seed('role-lastadmin');
  await makeOrgAdmin(a1.id);
  // a1 is the only admin; demoting self (= the last admin) must be blocked.
  const res = await sreq('POST', `/api/admin/users/${a1.id}/role`, {
    body: { role: 'member' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'cannot remove the last admin');
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [a1.id]);
  assert.equal(rows[0].role, 'admin', 'sole admin must remain admin');
});

test('POST /role can demote an admin when another admin remains', async () => {
  const { orgA, a1, a2 } = await seed('role-demote-ok');
  await makeOrgAdmin(a1.id);
  await makeOrgAdmin(a2.id);
  // Two admins: demoting a2 is allowed.
  const res = await sreq('POST', `/api/admin/users/${a2.id}/role`, {
    body: { role: 'member' },
    cookie: await adminCookie(a1.id, orgA.id),
  });
  assert.equal(res.status, 200);
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [a2.id]);
  assert.equal(rows[0].role, 'member');
});

// Bootstrap: the token mints the org's first admin via POST /api/admin/users.
test('POST /api/admin/users with role=admin bootstraps an admin + audit row', async () => {
  const { orgA } = await seed('bootstrap-admin');
  await pool.query(`DELETE FROM users WHERE lower(email) = 'bootstrap-admin@example.com'`);
  const res = await req('POST', '/api/admin/users', {
    body: { orgSlug: orgA.slug, email: 'bootstrap-admin@example.com', role: 'admin' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.role, 'admin');
  const { rows: grants } = await pool.query(
    `SELECT granted_by FROM role_grants WHERE user_id = $1`,
    [user.id],
  );
  assert.equal(grants.length, 1);
  assert.equal(grants[0].granted_by, 'admin_token');
  await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
});

test('POST /api/admin/users without role defaults to member (no audit row)', async () => {
  const { orgA } = await seed('bootstrap-member');
  await pool.query(`DELETE FROM users WHERE lower(email) = 'bootstrap-member@example.com'`);
  const res = await req('POST', '/api/admin/users', {
    body: { orgSlug: orgA.slug, email: 'bootstrap-member@example.com' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.role, 'member');
  const { rows: grants } = await pool.query('SELECT 1 FROM role_grants WHERE user_id = $1', [user.id]);
  assert.equal(grants.length, 0, 'member creation writes no role_grants row');
  await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
});

// POST /api/admin/teams ------------------------------------------------------

test('POST /teams with invalid name -> 400', async () => {
  const { orgA } = await seed('team-invalid');
  // Empty string fails the length CHECK; unicode emoji fails the regex CHECK.
  for (const bad of ['', 'team-with-emoji-🙂', 'x'.repeat(81)]) {
    const res = await req('POST', '/api/admin/teams', {
      body: { orgSlug: orgA.slug, name: bad },
      adminToken: ADMIN_TOKEN,
    });
    assert.equal(res.status, 400, `expected 400 for name=${JSON.stringify(bad)}`);
    const body = await res.json();
    assert.equal(body.error, 'invalid name');
  }
});

test('POST /teams happy path -> 201, team in the right org', async () => {
  const { orgA } = await seed('team-happy');
  const res = await req('POST', '/api/admin/teams', {
    body: { orgSlug: orgA.slug, name: 'Engineering' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 201);
  const { team } = await res.json();
  assert.equal(team.name, 'Engineering');
  assert.equal(team.org_id, orgA.id);
  assert.ok(team.id);
  assert.ok(team.created_at);
});

test('POST /teams duplicate name (case-insensitive) -> 409', async () => {
  const { orgA } = await seed('team-dup');
  const r1 = await req('POST', '/api/admin/teams', {
    body: { orgSlug: orgA.slug, name: 'Marketing' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(r1.status, 201);
  const r2 = await req('POST', '/api/admin/teams', {
    body: { orgSlug: orgA.slug, name: 'marketing' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(r2.status, 409);
  const body = await r2.json();
  assert.equal(body.error, 'team name already exists in this org');
});

// POST /api/admin/teams/:id/members -----------------------------------------

test('POST /teams/:id/members happy path -> 201, org_id matches', async () => {
  const { orgA, a1 } = await seed('members-happy');
  const { rows: teamRows } = await pool.query(
    `INSERT INTO teams (org_id, name) VALUES ($1, 'Sales') RETURNING id`,
    [orgA.id],
  );
  const teamId = teamRows[0].id;
  const res = await req('POST', `/api/admin/teams/${teamId}/members`, {
    body: { userEmail: a1.email },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 201);
  const { membership } = await res.json();
  assert.equal(membership.user_id, a1.id);
  assert.equal(membership.team_id, teamId);
  assert.equal(membership.org_id, orgA.id);
});

test('POST /teams/:id/members cross-org by email -> 400', async () => {
  const { orgA, b1 } = await seed('members-cross');
  const { rows: teamRows } = await pool.query(
    `INSERT INTO teams (org_id, name) VALUES ($1, 'Ops') RETURNING id`,
    [orgA.id],
  );
  const teamId = teamRows[0].id;
  const res = await req('POST', `/api/admin/teams/${teamId}/members`, {
    body: { userEmail: b1.email },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'cross-org add');
});

test('POST /teams/:id/members duplicate -> 409', async () => {
  const { orgA, a1 } = await seed('members-dup');
  const { rows: teamRows } = await pool.query(
    `INSERT INTO teams (org_id, name) VALUES ($1, 'Support') RETURNING id`,
    [orgA.id],
  );
  const teamId = teamRows[0].id;
  const r1 = await req('POST', `/api/admin/teams/${teamId}/members`, {
    body: { userEmail: a1.email },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(r1.status, 201);
  const r2 = await req('POST', `/api/admin/teams/${teamId}/members`, {
    body: { userEmail: a1.email },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(r2.status, 409);
  const body = await r2.json();
  assert.equal(body.error, 'already a member');
});

// Schema-level cross-org regression test ------------------------------------
// This is THE gate for the eng-critic finding. The handler refuses cross-org
// adds with a friendly 400, but the structural fix is the composite FK on
// team_memberships referencing (users.id, org_id) and (teams.id, org_id). A
// raw INSERT that bypasses the handler with a mismatched (user_id, org_id)
// has no valid (id, org_id) target in users and must error with 23503.

test('schema rejects a cross-org team_memberships INSERT with code 23503', async () => {
  const { orgA, a1 } = await seed('schema-cross');
  // Team belongs to orgA, but we'll claim org_id = orgB on the INSERT.
  const { orgB } = await seed('schema-cross');
  const { rows: teamRows } = await pool.query(
    `INSERT INTO teams (org_id, name) VALUES ($1, 'Schema') RETURNING id`,
    [orgA.id],
  );
  const teamId = teamRows[0].id;
  // The team_id+org_id pair (teamId, orgB.id) has no match in teams, so this
  // is the case the composite FK on (team_id, org_id) catches. Equivalently,
  // the (user_id, org_id) pair (a1.id, orgB.id) has no match in users.
  let caught;
  try {
    await pool.query(
      `INSERT INTO team_memberships (user_id, team_id, org_id) VALUES ($1, $2, $3)`,
      [a1.id, teamId, orgB.id],
    );
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'raw cross-org INSERT must error');
  assert.equal(caught.code, '23503', 'expected FK violation 23503');
});
