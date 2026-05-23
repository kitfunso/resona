import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from './index.js';
import { pool, migrate } from './db.js';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

let server;
let baseUrl;

test.before(async () => {
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

// Auth gating ----------------------------------------------------------------

test('POST /api/admin/users/:id/role without ADMIN_TOKEN -> 401', async () => {
  const { a1 } = await seed('auth-missing');
  const res = await req('POST', `/api/admin/users/${a1.id}/role`, { body: { role: 'admin' } });
  assert.equal(res.status, 401);
});

test('POST /api/admin/users/:id/role with wrong ADMIN_TOKEN -> 401', async () => {
  const { a1 } = await seed('auth-wrong');
  // Same length as the real token but different bytes, so the length-check
  // short-circuit doesn't fire and we exercise the timing-safe compare.
  const wrong = 'x'.repeat(ADMIN_TOKEN.length);
  const res = await req('POST', `/api/admin/users/${a1.id}/role`, {
    body: { role: 'admin' },
    adminToken: wrong,
  });
  assert.equal(res.status, 401);
});

// POST /api/admin/users/:id/role --------------------------------------------

test('POST /role with invalid role -> 400', async () => {
  const { a1 } = await seed('role-invalid');
  const res = await req('POST', `/api/admin/users/${a1.id}/role`, {
    body: { role: 'superuser' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid role');
});

test('POST /role for a missing user -> 404', async () => {
  await seed('role-missing');
  // A well-formed UUID that doesn't exist in the users table.
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const res = await req('POST', `/api/admin/users/${fakeId}/role`, {
    body: { role: 'admin' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'user not found');
});

test('POST /role with a malformed :id -> 400 (not a 500 from PG 22P02)', async () => {
  // Regression for the review-stage finding: a non-UUID :id used to escape
  // as PG 22P02 and become a generic 500. It must now return a clean 400.
  const res = await req('POST', '/api/admin/users/not-a-uuid/role', {
    body: { role: 'admin' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid id');
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

test('POST /role happy path: 200, role updated, single role_grants row written', async () => {
  const { a1 } = await seed('role-happy');
  const res = await req('POST', `/api/admin/users/${a1.id}/role`, {
    body: { role: 'admin' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.id, a1.id);
  assert.equal(user.role, 'admin');

  const { rows: userRows } = await pool.query('SELECT role FROM users WHERE id = $1', [a1.id]);
  assert.equal(userRows[0].role, 'admin');

  const { rows: grants } = await pool.query(
    'SELECT user_id, granted_role, granted_by FROM role_grants WHERE user_id = $1',
    [a1.id],
  );
  assert.equal(grants.length, 1, 'exactly one role_grants row');
  assert.equal(grants[0].user_id, a1.id);
  assert.equal(grants[0].granted_role, 'admin');
  assert.equal(grants[0].granted_by, 'admin_token');
});

test('POST /role no-op when role unchanged: 200, no new audit row', async () => {
  const { a1 } = await seed('role-noop');
  // First call: promote to admin, leaves one audit row.
  const r1 = await req('POST', `/api/admin/users/${a1.id}/role`, {
    body: { role: 'admin' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(r1.status, 200);
  const { rows: before } = await pool.query(
    'SELECT count(*)::int AS n FROM role_grants WHERE user_id = $1',
    [a1.id],
  );
  assert.equal(before[0].n, 1);
  // Second call with the same role: should be a no-op, no new audit row.
  const r2 = await req('POST', `/api/admin/users/${a1.id}/role`, {
    body: { role: 'admin' },
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(r2.status, 200);
  const { rows: after } = await pool.query(
    'SELECT count(*)::int AS n FROM role_grants WHERE user_id = $1',
    [a1.id],
  );
  assert.equal(after[0].n, 1, 'no-op must not insert another row');
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
