import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from './index.js';
import { pool, migrate } from './db.js';
import { issueSession, SESSION_COOKIE } from './auth.js';
import {
  MIN_GROUP,
  SUPPRESSED,
  BANDS,
  suppress,
  modalityDistribution,
} from './aggregates.js';

let server;
let baseUrl;

test.before(async () => {
  // Set BEFORE any requests fire so adminLimiter's skip predicate
  // (() => process.env.NODE_ENV === 'test') evaluates true at request time.
  // The limiter was created at module load with a stable function reference;
  // skip is re-evaluated per request, so setting NODE_ENV here is sufficient.
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

// Seed an org with the requested number of users at each role, plus optional
// check-ins distributed across kinds and bands. suffix keeps test cases from
// colliding on shared rows.
async function seedOrg(suffix, { members = 0, admins = 1, teamName = null } = {}) {
  const orgSlug = `agg-${suffix}`;
  // Wipe residue.
  await pool.query(
    `DELETE FROM team_memberships WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`,
    [orgSlug],
  );
  await pool.query(`DELETE FROM teams WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [orgSlug]);
  await pool.query(
    `DELETE FROM check_ins WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`,
    [orgSlug],
  );
  await pool.query(
    `DELETE FROM role_grants WHERE user_id IN (
       SELECT id FROM users WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)
     )`,
    [orgSlug],
  );
  await pool.query(`DELETE FROM users WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [orgSlug]);

  const { rows: orgRows } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, slug, name`,
    [orgSlug, `Agg Org ${suffix}`],
  );
  const org = orgRows[0];

  const users = [];
  for (let i = 0; i < admins; i += 1) {
    const email = `agg-admin-${i}-${suffix}@example.com`;
    const { rows } = await pool.query(
      `INSERT INTO users (org_id, email, role) VALUES ($1, lower($2), 'admin') RETURNING id`,
      [org.id, email],
    );
    users.push({ id: rows[0].id, email, role: 'admin' });
  }
  for (let i = 0; i < members; i += 1) {
    const email = `agg-member-${i}-${suffix}@example.com`;
    const { rows } = await pool.query(
      `INSERT INTO users (org_id, email, role) VALUES ($1, lower($2), 'member') RETURNING id`,
      [org.id, email],
    );
    users.push({ id: rows[0].id, email, role: 'member' });
  }

  let team = null;
  if (teamName) {
    const { rows } = await pool.query(
      `INSERT INTO teams (org_id, name) VALUES ($1, $2) RETURNING id, name`,
      [org.id, teamName],
    );
    team = rows[0];
  }

  return { org, users, team };
}

async function addToTeam(team, user) {
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, org_id) VALUES ($1, $2, $3)`,
    [user.id, team.id, team.org_id ?? team.orgId],
  );
}

// insertCheckIn writes one check_ins row. payload is built kind-specific so
// the JSONB paths in aggregates.js resolve.
async function insertCheckIn(user, orgId, kind, value, { daysAgo = 0 } = {}) {
  let payload;
  if (kind === 'heart') payload = { heart: { hrBpm: value } };
  else if (kind === 'breath') payload = { estimate: { percentPredicted: { fev1: value } } };
  else if (kind === 'motion') payload = { tremor: { classification: value } };
  else throw new Error(`unknown kind ${kind}`);

  await pool.query(
    `INSERT INTO check_ins (user_id, org_id, kind, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, now() - ($5::int * interval '1 day'))`,
    [user.id, orgId, kind, JSON.stringify(payload), daysAgo],
  );
}

async function adminCookie(user, org) {
  const token = await issueSession({ userId: user.id, orgId: org.id });
  return `${SESSION_COOKIE}=${token}`;
}

async function getJson(path, cookie) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${baseUrl}${path}`, { method: 'GET', headers });
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* leave null */ }
  return { status: res.status, body: parsed, raw: body };
}

// ---------------------------------------------------------------------------
// Case 1: Top-level suppression at the threshold (4 -> SUPPRESSED, 5 -> visible).
// ---------------------------------------------------------------------------
test('top-level suppression: n<MIN_GROUP suppresses; n>=MIN_GROUP returns', async () => {
  const { org, users } = await seedOrg('topn', { admins: 1, members: 5 });
  // Four check-ins from four distinct users.
  for (let i = 0; i < 4; i += 1) {
    await insertCheckIn(users[i], org.id, 'heart', 70);
  }
  let result = await modalityDistribution(org.id, 'heart', 30);
  assert.deepEqual(result, SUPPRESSED, 'n=4 must be suppressed');

  await insertCheckIn(users[4], org.id, 'heart', 70);
  result = await modalityDistribution(org.id, 'heart', 30);
  assert.equal(result.suppressed, undefined, 'n=5 must not be suppressed');
  assert.equal(result.n, 5);
});

// ---------------------------------------------------------------------------
// Case 1b (PRIV-1): suppression counts DISTINCT employees, not check-in rows.
// ---------------------------------------------------------------------------
test('distinct-employee suppression: one prolific user cannot clear the threshold', async () => {
  const { org, users } = await seedOrg('distinct', { admins: 1, members: 5 });
  // One employee checks in 6 times in the same band. Rows = 6 (>= MIN_GROUP)
  // but distinct employees = 1, so the response MUST be suppressed.
  for (let i = 0; i < 6; i += 1) await insertCheckIn(users[1], org.id, 'heart', 70);
  let result = await modalityDistribution(org.id, 'heart', 30);
  assert.deepEqual(result, SUPPRESSED, '1 user x6 check-ins -> distinct=1 -> SUPPRESSED');

  // Add four more DISTINCT employees (one check-in each) -> 5 distinct total.
  for (let i = 2; i <= 5; i += 1) await insertCheckIn(users[i], org.id, 'heart', 70);
  result = await modalityDistribution(org.id, 'heart', 30);
  assert.equal(result.suppressed, undefined, '5 distinct employees -> visible');
  assert.equal(result.n, 5, 'n counts distinct employees, not the 10 rows');
  const normal = result.buckets.find((b) => b.label === 'normal');
  assert.equal(normal.count, 5, 'bucket count is distinct employees');
});

// ---------------------------------------------------------------------------
// Case 2: Per-bucket suppression (the round-0 CRIT).
// ---------------------------------------------------------------------------
test('per-bucket suppression: small bucket suppressed even when total>=MIN_GROUP', async () => {
  const { org, users } = await seedOrg('perbucket', { admins: 1, members: 20 });
  // 18 normal-range, 2 low-range. Total n=20, but low bucket has 2.
  for (let i = 0; i < 18; i += 1) await insertCheckIn(users[i], org.id, 'heart', 70);
  for (let i = 18; i < 20; i += 1) await insertCheckIn(users[i], org.id, 'heart', 50);

  const result = await modalityDistribution(org.id, 'heart', 30);
  assert.equal(result.n, 20);
  const low = result.buckets.find((b) => b.label === 'low');
  const normal = result.buckets.find((b) => b.label === 'normal');
  const elevated = result.buckets.find((b) => b.label === 'elevated');
  assert.deepEqual(low.count, SUPPRESSED, 'bucket with count=2 must be suppressed');
  assert.equal(normal.count, 18, 'large bucket must not be suppressed');
  assert.equal(elevated.count, 0, 'empty bucket stays as 0 (non-identifying)');
});

// ---------------------------------------------------------------------------
// Case 3: Cross-org isolation across all 3 routes.
// ---------------------------------------------------------------------------
test('cross-org isolation across overview/teams/team-overview', async () => {
  const a = await seedOrg('isoA', { admins: 1, members: 5, teamName: 'A-Team' });
  const b = await seedOrg('isoB', { admins: 1, members: 5, teamName: 'B-Team' });
  for (const u of a.users.slice(0, 5)) await insertCheckIn(u, a.org.id, 'heart', 70);
  for (const u of b.users.slice(0, 5)) await insertCheckIn(u, b.org.id, 'heart', 120);

  const cookie = await adminCookie(a.users[0], a.org);
  // overview only counts org A.
  const ov = await getJson('/api/admin/overview', cookie);
  assert.equal(ov.status, 200);
  const heart = ov.body.distributions.heart;
  assert.equal(heart.n, 5);
  const elevated = heart.buckets.find((b) => b.label === 'elevated');
  // org B has 5 elevated; org A has 0. If we leaked, elevated would be 5.
  assert.equal(elevated.count, 0);

  // teams list only shows org A teams.
  const tm = await getJson('/api/admin/teams', cookie);
  assert.equal(tm.status, 200);
  assert.equal(tm.body.teams.length, 1);
  assert.equal(tm.body.teams[0].name, 'A-Team');

  // team-overview on org B's team must 404.
  const fto = await getJson(`/api/admin/teams/${b.team.id}/overview`, cookie);
  assert.equal(fto.status, 404);
  assert.deepEqual(fto.body, { error: 'not found' });
});

// ---------------------------------------------------------------------------
// Case 4: Team-route 404 byte-identity (the round-0 CRIT).
// ---------------------------------------------------------------------------
test('team-route 404 byte-identical: foreign-org vs non-existent vs malformed', async () => {
  const a = await seedOrg('biA', { admins: 1, members: 5 });
  const b = await seedOrg('biB', { admins: 1, members: 5, teamName: 'B-Team' });
  const cookie = await adminCookie(a.users[0], a.org);

  const foreign = await getJson(`/api/admin/teams/${b.team.id}/overview`, cookie);
  const nonExistent = await getJson(
    `/api/admin/teams/00000000-0000-0000-0000-000000000000/overview`,
    cookie,
  );
  const malformed = await getJson(`/api/admin/teams/not-a-uuid/overview`, cookie);

  // Status identical across all three.
  assert.equal(foreign.status, 404);
  assert.equal(nonExistent.status, 404);
  assert.equal(malformed.status, 404);
  // Body identical across all three.
  assert.deepEqual(foreign.body, { error: 'not found' });
  assert.deepEqual(nonExistent.body, { error: 'not found' });
  assert.deepEqual(malformed.body, { error: 'not found' });
  // Raw text identical (catches stray whitespace / key ordering).
  assert.equal(foreign.raw, nonExistent.raw);
  assert.equal(foreign.raw, malformed.raw);
});

// ---------------------------------------------------------------------------
// Case 5: requireOrgAdmin gating on each new route (member -> 403 + audit).
// ---------------------------------------------------------------------------
test('member session hitting each aggregate route gets 403 with [admin-deny] audit', async () => {
  const { org, users, team } = await seedOrg('gate', { admins: 1, members: 1, teamName: 'Gate' });
  const member = users.find((u) => u.role === 'member');
  const cookie = await adminCookie(member, org);

  const captured = [];
  const original = console.info;
  console.info = (...args) => captured.push(args.join(' '));
  try {
    const a = await getJson('/api/admin/overview', cookie);
    const b = await getJson('/api/admin/teams', cookie);
    const c = await getJson(`/api/admin/teams/${team.id}/overview`, cookie);
    assert.equal(a.status, 403);
    assert.equal(b.status, 403);
    assert.equal(c.status, 403);
  } finally {
    console.info = original;
  }
  const denyLines = captured.filter((l) => l.startsWith('[admin-deny]'));
  assert.equal(denyLines.length, 3, `expected 3 [admin-deny] lines, got ${denyLines.length}`);
  for (const line of denyLines) {
    assert.ok(line.includes(`user=${member.id}`));
    assert.ok(line.includes('role=member'));
  }
});

// ---------------------------------------------------------------------------
// Case 6: ?days input contract.
// ---------------------------------------------------------------------------
test('?days contract: reject malformed/out-of-range, default 30, no silent clamp', async () => {
  const { org, users } = await seedOrg('days', { admins: 1, members: 5 });
  for (let i = 0; i < 5; i += 1) await insertCheckIn(users[i + 1], org.id, 'heart', 70);
  const cookie = await adminCookie(users[0], org);

  // Default + valid.
  assert.equal((await getJson('/api/admin/overview', cookie)).status, 200);
  assert.equal((await getJson('/api/admin/overview?days=30', cookie)).status, 200);
  assert.equal((await getJson('/api/admin/overview?days=1', cookie)).status, 200);
  assert.equal((await getJson('/api/admin/overview?days=365', cookie)).status, 200);

  // Malformed / out-of-range -> 400, no clamp.
  for (const bad of ['', 'foo', '-1', '0', '366', '99999', '1.5', '30foo', '+30']) {
    const r = await getJson(`/api/admin/overview?days=${encodeURIComponent(bad)}`, cookie);
    assert.equal(r.status, 400, `days=${bad} expected 400, got ${r.status}`);
    assert.match(r.body.error, /days must be integer in \[1,365\]/);
  }
});

// ---------------------------------------------------------------------------
// Case 7: Band-edge stability (half-open intervals).
// ---------------------------------------------------------------------------
test('band-edge stability: hrBpm=60 -> normal; hrBpm=100 -> elevated', async () => {
  const { org, users } = await seedOrg('edge', { admins: 1, members: 5 });
  // 5 check-ins exactly at the low/normal boundary (60).
  for (let i = 0; i < 5; i += 1) await insertCheckIn(users[i + 1], org.id, 'heart', 60);
  let result = await modalityDistribution(org.id, 'heart', 30);
  let normal = result.buckets.find((b) => b.label === 'normal');
  assert.equal(normal.count, 5, '60 must land in normal (half-open [60, 100))');
  let low = result.buckets.find((b) => b.label === 'low');
  assert.equal(low.count, 0);

  // Replace seed with exactly-100s.
  await pool.query('DELETE FROM check_ins WHERE org_id = $1', [org.id]);
  for (let i = 0; i < 5; i += 1) await insertCheckIn(users[i + 1], org.id, 'heart', 100);
  result = await modalityDistribution(org.id, 'heart', 30);
  const elevated = result.buckets.find((b) => b.label === 'elevated');
  normal = result.buckets.find((b) => b.label === 'normal');
  assert.equal(elevated.count, 5, '100 must land in elevated (half-open [100, inf))');
  assert.equal(normal.count, 0);
});

// ---------------------------------------------------------------------------
// Case 8: Empty-org behaviour. total>=MIN_GROUP but zero check-ins -> distributions SUPPRESSED.
// ---------------------------------------------------------------------------
test('empty org: zero check-ins returns SUPPRESSED, never {n:0, buckets:[]}', async () => {
  const { org, users } = await seedOrg('empty', { admins: 1, members: 7 });
  const cookie = await adminCookie(users[0], org);
  const ov = await getJson('/api/admin/overview', cookie);
  assert.equal(ov.status, 200);
  assert.deepEqual(ov.body.distributions.heart, SUPPRESSED);
  assert.deepEqual(ov.body.distributions.breath, SUPPRESSED);
  assert.deepEqual(ov.body.distributions.motion, SUPPRESSED);
  // participation: total=8 (>=5), active=0 (<5) -> {active: SUPPRESSED, total: 8}.
  assert.deepEqual(ov.body.participation.active, SUPPRESSED);
  assert.equal(ov.body.participation.total, 8);
});

// ---------------------------------------------------------------------------
// Case 9: orgParticipation active<MIN_GROUP path.
// ---------------------------------------------------------------------------
test('orgParticipation active<MIN_GROUP suppressed even when total>=MIN_GROUP', async () => {
  const { org, users } = await seedOrg('active', { admins: 1, members: 7 });
  // Only 3 of the 8 users check in.
  await insertCheckIn(users[0], org.id, 'heart', 70);
  await insertCheckIn(users[1], org.id, 'heart', 70);
  await insertCheckIn(users[2], org.id, 'heart', 70);
  const cookie = await adminCookie(users[0], org);
  const ov = await getJson('/api/admin/overview', cookie);
  assert.deepEqual(ov.body.participation.active, SUPPRESSED);
  assert.equal(ov.body.participation.total, 8);
});

// ---------------------------------------------------------------------------
// Case 10: JSONB path correctness + motion 'unknown' fallback.
// ---------------------------------------------------------------------------
test('JSONB paths: heart/breath/motion route to correct buckets, motion unknown fallback', async () => {
  const { org, users } = await seedOrg('paths', { admins: 1, members: 12 });
  // heart: 50/70/120 -> low/normal/elevated, 2 each + 1 extra = 5 normal
  await insertCheckIn(users[0], org.id, 'heart', 50);
  await insertCheckIn(users[1], org.id, 'heart', 50);
  await insertCheckIn(users[2], org.id, 'heart', 70);
  await insertCheckIn(users[3], org.id, 'heart', 70);
  await insertCheckIn(users[4], org.id, 'heart', 70);
  await insertCheckIn(users[5], org.id, 'heart', 70);
  await insertCheckIn(users[6], org.id, 'heart', 70);
  await insertCheckIn(users[7], org.id, 'heart', 120);
  await insertCheckIn(users[8], org.id, 'heart', 120);
  // 9 total, 2 in low (suppressed), 5 in normal (visible), 2 in elevated (suppressed).
  let result = await modalityDistribution(org.id, 'heart', 30);
  assert.equal(result.n, 9);
  const heartLow = result.buckets.find((b) => b.label === 'low');
  const heartNormal = result.buckets.find((b) => b.label === 'normal');
  const heartElev = result.buckets.find((b) => b.label === 'elevated');
  assert.deepEqual(heartLow.count, SUPPRESSED);
  assert.equal(heartNormal.count, 5);
  assert.deepEqual(heartElev.count, SUPPRESSED);

  // breath: 75/90/110 routed to below_predicted / predicted / above_predicted.
  // 5 predicted to clear suppression, 0 of the others.
  await pool.query('DELETE FROM check_ins WHERE org_id = $1', [org.id]);
  for (let i = 0; i < 5; i += 1) await insertCheckIn(users[i], org.id, 'breath', 90);
  result = await modalityDistribution(org.id, 'breath', 30);
  const breathPred = result.buckets.find((b) => b.label === 'predicted');
  assert.equal(breathPred.count, 5);
  // Catches a JSONB path typo: if path was wrong, all rows would fall to
  // the unknown / else branch and predicted would be 0.

  // motion: each known classification + one out-of-set value -> 'unknown'.
  await pool.query('DELETE FROM check_ins WHERE org_id = $1', [org.id]);
  await insertCheckIn(users[0], org.id, 'motion', 'parkinsonian_like');
  await insertCheckIn(users[1], org.id, 'motion', 'essential_like');
  await insertCheckIn(users[2], org.id, 'motion', 'physiological');
  await insertCheckIn(users[3], org.id, 'motion', 'physiological');
  await insertCheckIn(users[4], org.id, 'motion', 'physiological');
  await insertCheckIn(users[5], org.id, 'motion', 'physiological');
  await insertCheckIn(users[6], org.id, 'motion', 'physiological');
  await insertCheckIn(users[7], org.id, 'motion', 'some_future_class');
  // 8 total: 1 park (suppressed), 1 essential (suppressed), 5 physio (visible), 1 unknown (suppressed).
  result = await modalityDistribution(org.id, 'motion', 30);
  assert.equal(result.n, 8);
  const physio = result.buckets.find((b) => b.label === 'physiological');
  const unknown = result.buckets.find((b) => b.label === 'unknown');
  assert.equal(physio.count, 5);
  assert.deepEqual(unknown.count, SUPPRESSED);
});

// ---------------------------------------------------------------------------
// Case 11: Team scope correctness.
// ---------------------------------------------------------------------------
test('team scope: team-overview returns subset of org-wide', async () => {
  const { org, users, team } = await seedOrg('teamscope', { admins: 1, members: 10, teamName: 'T1' });
  // First 6 members are on the team and all check in 'normal'.
  for (let i = 1; i <= 6; i += 1) {
    await addToTeam({ id: team.id, org_id: org.id }, users[i]);
    await insertCheckIn(users[i], org.id, 'heart', 70);
  }
  // The other 4 are off-team and check in 'elevated'. Total org n=10, team n=6.
  for (let i = 7; i <= 10; i += 1) {
    await insertCheckIn(users[i], org.id, 'heart', 120);
  }

  const cookie = await adminCookie(users[0], org);
  const ov = await getJson('/api/admin/overview', cookie);
  assert.equal(ov.body.distributions.heart.n, 10);
  const ovElev = ov.body.distributions.heart.buckets.find((b) => b.label === 'elevated');
  assert.deepEqual(ovElev.count, SUPPRESSED, '4 elevated org-wide -> suppressed');

  const teamOv = await getJson(`/api/admin/teams/${team.id}/overview`, cookie);
  assert.equal(teamOv.status, 200);
  assert.equal(teamOv.body.distributions.heart.n, 6);
  const teamElev = teamOv.body.distributions.heart.buckets.find((b) => b.label === 'elevated');
  const teamNormal = teamOv.body.distributions.heart.buckets.find((b) => b.label === 'normal');
  assert.equal(teamElev.count, 0, 'team has no elevated check-ins');
  assert.equal(teamNormal.count, 6);
});

// ---------------------------------------------------------------------------
// Case 12: Band-override rejection (route layer + structural).
// ---------------------------------------------------------------------------
test('band-override rejection: extra query params do not affect bucketing', async () => {
  const { org, users } = await seedOrg('override', { admins: 1, members: 5 });
  for (let i = 0; i < 5; i += 1) await insertCheckIn(users[i + 1], org.id, 'heart', 70);
  const cookie = await adminCookie(users[0], org);

  const normal = await getJson('/api/admin/overview?days=30', cookie);
  const probe = await getJson(
    '/api/admin/overview?days=30&bands=very-fine&buckets=10&granularity=fine',
    cookie,
  );
  // Buckets are identical: the route layer drops the unknown query params.
  assert.deepEqual(probe.body.distributions, normal.body.distributions);

  // Structural: modalityDistribution accepts the documented opts shape and
  // ignores extras. Any extra keys do NOT alter behaviour.
  const direct = await modalityDistribution(org.id, 'heart', 30, {
    teamId: undefined,
    // The following extras are intentionally garbage; the function must not
    // honour them. A future regression where any of these mutate bucketing
    // would fail this assertion.
    bandOverrides: [{ label: 'fine', min: 0, max: 10 }],
    granularity: 'high',
  });
  // Expected: same 3 heart bands + 'unknown' label structure (no 'fine' label).
  const labels = direct.buckets.map((b) => b.label).sort();
  assert.deepEqual(labels, ['elevated', 'low', 'normal'], 'no override labels reached the output');
});

// ---------------------------------------------------------------------------
// Case 13a: admin-read audit line on success path (Art 5(2) accountability).
// ---------------------------------------------------------------------------
test('successful admin reads emit [admin-read] audit lines', async () => {
  const { org, users } = await seedOrg('audit', { admins: 1, members: 5 });
  for (let i = 0; i < 5; i += 1) await insertCheckIn(users[i + 1], org.id, 'heart', 70);
  const cookie = await adminCookie(users[0], org);

  const captured = [];
  const original = console.info;
  console.info = (...args) => captured.push(args.join(' '));
  try {
    const ov = await getJson('/api/admin/overview', cookie);
    const tm = await getJson('/api/admin/teams', cookie);
    assert.equal(ov.status, 200);
    assert.equal(tm.status, 200);
  } finally {
    console.info = original;
  }
  const readLines = captured.filter((l) => l.startsWith('[admin-read]'));
  assert.equal(readLines.length, 2, `expected 2 [admin-read] lines, got ${readLines.length}`);
  for (const line of readLines) {
    assert.ok(line.includes(`user=${users[0].id}`));
    assert.ok(line.includes(`org=${org.id}`));
  }
});

// ---------------------------------------------------------------------------
// Case 13b: 404 byte-identity holds when ?days is also malformed.
// ---------------------------------------------------------------------------
test('team-route 404 holds byte-identity under malformed ?days (parseDays runs first)', async () => {
  const a = await seedOrg('idA', { admins: 1, members: 5 });
  const b = await seedOrg('idB', { admins: 1, members: 5, teamName: 'B-Team' });
  const cookie = await adminCookie(a.users[0], a.org);

  // With malformed ?days, parseDays returns 400 for ALL UUID classes.
  // The malformed-UUID + malformed-days case must NOT short-circuit to 404 -
  // that would distinguish well-formed-vs-malformed UUID via the ?days probe.
  const malformedDays = '?days=foo';
  const foreign = await getJson(`/api/admin/teams/${b.team.id}/overview${malformedDays}`, cookie);
  const nonExistent = await getJson(
    `/api/admin/teams/00000000-0000-0000-0000-000000000000/overview${malformedDays}`,
    cookie,
  );
  const malformed = await getJson(`/api/admin/teams/not-a-uuid/overview${malformedDays}`, cookie);

  assert.equal(foreign.status, 400, 'malformed days returns 400 for foreign-org UUID');
  assert.equal(nonExistent.status, 400, 'malformed days returns 400 for non-existent UUID');
  assert.equal(malformed.status, 400, 'malformed days returns 400 for malformed UUID');
  // All three responses are byte-identical (no UUID information leaks via probe).
  assert.equal(foreign.raw, nonExistent.raw);
  assert.equal(foreign.raw, malformed.raw);
});

// ---------------------------------------------------------------------------
// Case 14: BANDS export is deeply frozen (cannot mutate at runtime).
// ---------------------------------------------------------------------------
test('BANDS is deeply frozen', () => {
  assert.ok(Object.isFrozen(BANDS));
  assert.ok(Object.isFrozen(BANDS.heart));
  assert.ok(Object.isFrozen(BANDS.heart[0]));
  // suppress is also exported as a function (sanity).
  assert.equal(typeof suppress, 'function');
  assert.equal(MIN_GROUP, 5);
});
