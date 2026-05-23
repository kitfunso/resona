import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from './index.js';
import { pool, migrate } from './db.js';
import { issueSession, SESSION_COOKIE } from './auth.js';

let server;
let baseUrl;

test.before(async () => {
  await migrate();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// Build a real session cookie via issueSession so requireAuth treats the
// request as a logged-in user. Mirrors the production path: the cookie
// jar is identical to what /api/auth/verify-code would have set.
async function authedReq(urlPath, { userId, orgId, cookie } = {}) {
  const headers = {};
  if (cookie === false) {
    // explicit no-cookie case for the 401 test
  } else if (cookie) {
    headers.cookie = cookie;
  } else {
    const token = await issueSession({ userId, orgId });
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  return fetch(`${baseUrl}${urlPath}`, { method: 'GET', headers });
}

// Seed a pair of users in two orgs scoped to a per-test suffix. Wipes any
// rows tied to that suffix first so tests are independent of run order.
async function seed(suffix) {
  const orgASlug = `me-checkins-a-${suffix}`;
  const orgBSlug = `me-checkins-b-${suffix}`;
  const userAEmail = `a-${suffix}@example.com`;
  const userBEmail = `b-${suffix}@example.com`;

  await pool.query(
    `DELETE FROM check_ins WHERE user_id IN (
       SELECT id FROM users WHERE lower(email) IN ($1, $2)
     )`,
    [userAEmail, userBEmail],
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
         ON CONFLICT (lower(email)) DO UPDATE SET org_id = EXCLUDED.org_id`,
      [orgId, email],
    );
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    return rows[0];
  }
  const userA = await upsertUser(orgAId, userAEmail);
  const userB = await upsertUser(orgBId, userBEmail);
  return {
    orgA: { id: orgAId, slug: orgASlug },
    orgB: { id: orgBId, slug: orgBSlug },
    userA: { ...userA, email: userAEmail },
    userB: { ...userB, email: userBEmail },
  };
}

// Insert a check-in directly. createdAt lets tests force ordering without
// sleeping. Payload shape mirrors the analyze handlers exactly.
async function insertCheckIn({ userId, orgId, kind, payload, createdAt }) {
  if (createdAt) {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [userId, orgId, kind, JSON.stringify(payload), createdAt],
    );
  } else {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, orgId, kind, JSON.stringify(payload)],
    );
  }
}

// Payload fixtures shaped exactly like the analyze handlers persist them.
// Each fixture deliberately includes the full set of fields that MUST NOT
// appear in the response so the negative-assertion test is meaningful.
function breathPayload(headline) {
  return {
    features: { peakFlow: 7.1, fev1: 3.4, pef: 7.1 },
    estimate: {
      fev1: 3.4,
      fvc: 4.5,
      pef: 7.1,
      effortScore: 0.92,
      percentPredicted: { fev1: 95, fvc: 92, pef: 99 },
    },
    atsFlags: ['peak_late', 'short_exhalation'],
    personalReport: {
      headline,
      actions: ['Drink water', 'Rest'],
      whenToWorry: 'See a doctor if breathless at rest.',
      interpretation: 'Within normal range for your demographics.',
      source: 'fallback',
    },
  };
}

function motionPayload(headline) {
  return {
    tremor: { dominantHz: 5.4, classification: 'physiological' },
    gait: { stepsPerMin: 110, classification: 'low_snr' },
    neuroReport: {
      headline,
      actions: ['Try again in better light'],
      whenToWorry: 'If symptoms persist.',
      interpretation: 'Stillness and gait both look typical.',
      source: 'ai',
    },
  };
}

function heartPayload(headline) {
  return {
    heart: { hrBpm: 68, hrvRmssd: 42, quality: { grade: 'good' } },
    heartReport: {
      headline,
      actions: ['Keep moving daily'],
      whenToWorry: 'If your resting HR climbs above 100.',
      interpretation: 'Resting heart rate within typical range.',
      source: 'ai',
    },
  };
}

// 1. Auth gating -------------------------------------------------------------

test('GET /api/me/check-ins without cookie -> 401', async () => {
  const res = await authedReq('/api/me/check-ins', { cookie: false });
  assert.equal(res.status, 401);
});

test('GET /api/me/check-ins with tampered cookie -> 401', async () => {
  // Well-formed JWT shape but invalid signature; verifySession will throw.
  const tampered = `${SESSION_COOKIE}=eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.bad-signature`;
  const res = await authedReq('/api/me/check-ins', { cookie: tampered });
  assert.equal(res.status, 401);
});

// 2. Empty -------------------------------------------------------------------

test('GET /api/me/check-ins with zero rows -> empty list, default limit, not truncated', async () => {
  const { userA, orgA } = await seed('empty');
  const res = await authedReq('/api/me/check-ins', { userId: userA.id, orgId: orgA.id });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { checkIns: [], limit: 50, truncated: false });
});

// 3. Populated allowlist -----------------------------------------------------

test('GET /api/me/check-ins populated -> each row carries exactly the four allowlisted keys', async () => {
  const { userA, orgA } = await seed('allowlist');
  await insertCheckIn({ userId: userA.id, orgId: orgA.id, kind: 'breath', payload: breathPayload('breath head') });
  await insertCheckIn({ userId: userA.id, orgId: orgA.id, kind: 'motion', payload: motionPayload('motion head') });
  await insertCheckIn({ userId: userA.id, orgId: orgA.id, kind: 'heart', payload: heartPayload('heart head') });

  const res = await authedReq('/api/me/check-ins', { userId: userA.id, orgId: orgA.id });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.checkIns.length, 3);
  const allowed = new Set(['id', 'kind', 'createdAt', 'headline']);
  for (const row of body.checkIns) {
    const keys = Object.keys(row);
    assert.equal(keys.length, allowed.size, `row had unexpected keys: ${keys.join(',')}`);
    for (const key of keys) {
      assert.ok(allowed.has(key), `row carried disallowed key: ${key}`);
    }
    assert.ok(typeof row.id === 'string' && row.id.length > 0);
    assert.ok(['breath', 'motion', 'heart'].includes(row.kind));
    assert.ok(typeof row.createdAt === 'string' && row.createdAt.length > 0);
    assert.ok(typeof row.headline === 'string' || row.headline === null);
  }
});

// 4. Negative-assertion shape ------------------------------------------------

test('GET /api/me/check-ins response body never contains raw payload field names or classification tokens', async () => {
  const { userA, orgA } = await seed('negative');
  // Seed one of each kind so all three CASE arms of the SQL are exercised
  // and every payload variant the analyze handlers can persist is present.
  await insertCheckIn({ userId: userA.id, orgId: orgA.id, kind: 'breath', payload: breathPayload('b headline') });
  await insertCheckIn({ userId: userA.id, orgId: orgA.id, kind: 'motion', payload: motionPayload('m headline') });
  await insertCheckIn({ userId: userA.id, orgId: orgA.id, kind: 'heart', payload: heartPayload('h headline') });

  const res = await authedReq('/api/me/check-ins', { userId: userA.id, orgId: orgA.id });
  assert.equal(res.status, 200);
  const raw = await res.text();

  // Substrings that target raw check_ins.payload sub-keys and classification
  // tokens. Quoted-and-colon-anchored (e.g. '"fev1":') so a future headline
  // containing the bare letters cannot trigger a false positive. The bare
  // discriminator '"kind":"heart"' is allowed in the response; '"heart"'
  // would collide with it, so we target the raw payload.heart object via its
  // distinct sentinel keys ('"hrBpm":' / '"hrvRmssd":' / '"quality":') instead.
  const forbiddenSubstrings = [
    '"features":',
    '"atsFlags":',
    '"estimate":',
    '"actions":',
    '"whenToWorry":',
    '"interpretation":',
    '"percentPredicted":',
    '"fev1":',
    '"fvc":',
    '"pef":',
    '"hrBpm":',
    '"hrvRmssd":',
    '"tremor":',
    '"gait":',
    '"personalReport":',
    '"neuroReport":',
    '"heartReport":',
    '"payload":',
    '"quality":',
    'parkinsonian_like',
    'essential_like',
    'physiological',
    'tachycardia',
    'bradycardia',
    'low_for_young_adult',
    'low_snr',
    'peak_late',
    'short_exhalation',
  ];
  for (const needle of forbiddenSubstrings) {
    assert.ok(
      !raw.includes(needle),
      `response body must not contain ${needle}; got: ${raw.slice(0, 400)}`,
    );
  }
});

// 5. Per-kind headline -------------------------------------------------------

test('GET /api/me/check-ins maps headline per-kind: breath/motion/heart', async () => {
  const { userA, orgA } = await seed('headline');
  // Use distinct createdAt values so the order is deterministic; newest first.
  const base = Date.now();
  await insertCheckIn({
    userId: userA.id,
    orgId: orgA.id,
    kind: 'breath',
    payload: breathPayload('BREATH_HEAD'),
    createdAt: new Date(base - 3000).toISOString(),
  });
  await insertCheckIn({
    userId: userA.id,
    orgId: orgA.id,
    kind: 'motion',
    payload: motionPayload('MOTION_HEAD'),
    createdAt: new Date(base - 2000).toISOString(),
  });
  await insertCheckIn({
    userId: userA.id,
    orgId: orgA.id,
    kind: 'heart',
    payload: heartPayload('HEART_HEAD'),
    createdAt: new Date(base - 1000).toISOString(),
  });

  const res = await authedReq('/api/me/check-ins', { userId: userA.id, orgId: orgA.id });
  assert.equal(res.status, 200);
  const body = await res.json();
  const byKind = Object.fromEntries(body.checkIns.map((r) => [r.kind, r.headline]));
  assert.equal(byKind.breath, 'BREATH_HEAD');
  assert.equal(byKind.motion, 'MOTION_HEAD');
  assert.equal(byKind.heart, 'HEART_HEAD');
});

// 6. Cross-user isolation ----------------------------------------------------

test('GET /api/me/check-ins never returns rows belonging to another user (different orgs)', async () => {
  const { userA, userB, orgA, orgB } = await seed('isolation-cross-org');
  await insertCheckIn({ userId: userA.id, orgId: orgA.id, kind: 'breath', payload: breathPayload('A row') });
  await insertCheckIn({ userId: userB.id, orgId: orgB.id, kind: 'breath', payload: breathPayload('B row') });
  await insertCheckIn({ userId: userB.id, orgId: orgB.id, kind: 'motion', payload: motionPayload('B row 2') });

  const res = await authedReq('/api/me/check-ins', { userId: userA.id, orgId: orgA.id });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.checkIns.length, 1);
  const { rows: bRows } = await pool.query(
    'SELECT id FROM check_ins WHERE user_id = $1',
    [userB.id],
  );
  const bIds = new Set(bRows.map((r) => r.id));
  for (const row of body.checkIns) {
    assert.ok(!bIds.has(row.id), `row ${row.id} belongs to user B`);
  }
});

test('GET /api/me/check-ins never returns rows belonging to another user in the same org', async () => {
  // Same-org isolation: both users in orgA. Authoritative scoping is by
  // user_id, not org_id, and this proves it.
  const suffix = 'isolation-same-org';
  const orgSlug = `me-checkins-shared-${suffix}`;
  const userAEmail = `same-a-${suffix}@example.com`;
  const userBEmail = `same-b-${suffix}@example.com`;

  await pool.query(
    `DELETE FROM check_ins WHERE user_id IN (
       SELECT id FROM users WHERE lower(email) IN ($1, $2)
     )`,
    [userAEmail, userBEmail],
  );
  const { rows: orgRows } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgSlug, 'Shared Org'],
  );
  const orgId = orgRows[0].id;
  await pool.query(
    `INSERT INTO users (org_id, email) VALUES ($1, lower($2))
       ON CONFLICT (lower(email)) DO UPDATE SET org_id = EXCLUDED.org_id`,
    [orgId, userAEmail],
  );
  await pool.query(
    `INSERT INTO users (org_id, email) VALUES ($1, lower($2))
       ON CONFLICT (lower(email)) DO UPDATE SET org_id = EXCLUDED.org_id`,
    [orgId, userBEmail],
  );
  const { rows: aRows } = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [userAEmail]);
  const { rows: bRows } = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [userBEmail]);
  const userAId = aRows[0].id;
  const userBId = bRows[0].id;

  await insertCheckIn({ userId: userAId, orgId, kind: 'breath', payload: breathPayload('A row') });
  await insertCheckIn({ userId: userBId, orgId, kind: 'breath', payload: breathPayload('B row') });
  await insertCheckIn({ userId: userBId, orgId, kind: 'heart', payload: heartPayload('B row 2') });

  const res = await authedReq('/api/me/check-ins', { userId: userAId, orgId });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.checkIns.length, 1);
  const { rows: bCheckIns } = await pool.query(
    'SELECT id FROM check_ins WHERE user_id = $1',
    [userBId],
  );
  const bIds = new Set(bCheckIns.map((r) => r.id));
  for (const row of body.checkIns) {
    assert.ok(!bIds.has(row.id), `row ${row.id} belongs to user B`);
  }
});

// 7. Limit clamping ----------------------------------------------------------

test('GET /api/me/check-ins limit clamping covers the four invalid inputs and the over-cap case', async () => {
  const { userA, orgA } = await seed('limit-clamp');
  // Seed 5 rows so we can also see the body length matches expectations
  // where limit > rows. Tests the "limit, never 400" contract.
  for (let i = 0; i < 5; i++) {
    await insertCheckIn({
      userId: userA.id,
      orgId: orgA.id,
      kind: 'breath',
      payload: breathPayload(`row ${i}`),
      createdAt: new Date(Date.now() - (5 - i) * 1000).toISOString(),
    });
  }

  // ?limit=10000 -> clamped to 200 (the cap)
  const rOver = await authedReq('/api/me/check-ins?limit=10000', { userId: userA.id, orgId: orgA.id });
  assert.equal(rOver.status, 200);
  const bOver = await rOver.json();
  assert.equal(bOver.limit, 200);
  assert.equal(bOver.checkIns.length, 5);
  assert.equal(bOver.truncated, false);

  // ?limit=-1 -> default 50
  const rNeg = await authedReq('/api/me/check-ins?limit=-1', { userId: userA.id, orgId: orgA.id });
  assert.equal(rNeg.status, 200);
  const bNeg = await rNeg.json();
  assert.equal(bNeg.limit, 50);

  // ?limit=abc -> default 50 (NaN)
  const rAbc = await authedReq('/api/me/check-ins?limit=abc', { userId: userA.id, orgId: orgA.id });
  assert.equal(rAbc.status, 200);
  const bAbc = await rAbc.json();
  assert.equal(bAbc.limit, 50);

  // ?limit=0 -> default 50 (< 1)
  const rZero = await authedReq('/api/me/check-ins?limit=0', { userId: userA.id, orgId: orgA.id });
  assert.equal(rZero.status, 200);
  const bZero = await rZero.json();
  assert.equal(bZero.limit, 50);

  // missing limit -> default 50
  const rMissing = await authedReq('/api/me/check-ins', { userId: userA.id, orgId: orgA.id });
  assert.equal(rMissing.status, 200);
  const bMissing = await rMissing.json();
  assert.equal(bMissing.limit, 50);

  // truncated true when rows.length === limit. Use ?limit=3 with 5 seeded rows.
  const rTrunc = await authedReq('/api/me/check-ins?limit=3', { userId: userA.id, orgId: orgA.id });
  assert.equal(rTrunc.status, 200);
  const bTrunc = await rTrunc.json();
  assert.equal(bTrunc.limit, 3);
  assert.equal(bTrunc.checkIns.length, 3);
  assert.equal(bTrunc.truncated, true);
});

// 8. Order -------------------------------------------------------------------

test('GET /api/me/check-ins returns rows newest-first', async () => {
  const { userA, orgA } = await seed('order');
  const base = Date.now();
  // Insert 6 rows with deliberately scrambled createdAt values so the
  // newest-first ordering can't be a coincidence of insert order.
  const rows = [
    { kind: 'breath', headline: 'r0', delta: -6000 },
    { kind: 'motion', headline: 'r1', delta: -1000 },
    { kind: 'heart', headline: 'r2', delta: -4000 },
    { kind: 'breath', headline: 'r3', delta: -2000 },
    { kind: 'motion', headline: 'r4', delta: -5000 },
    { kind: 'heart', headline: 'r5', delta: -3000 },
  ];
  for (const row of rows) {
    const payload =
      row.kind === 'breath' ? breathPayload(row.headline) :
      row.kind === 'motion' ? motionPayload(row.headline) :
      heartPayload(row.headline);
    await insertCheckIn({
      userId: userA.id,
      orgId: orgA.id,
      kind: row.kind,
      payload,
      createdAt: new Date(base + row.delta).toISOString(),
    });
  }
  const res = await authedReq('/api/me/check-ins', { userId: userA.id, orgId: orgA.id });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.checkIns.length, 6);
  // Newest first: r1 (delta -1000), r3 (-2000), r5 (-3000), r2 (-4000), r4 (-5000), r0 (-6000).
  const expectedOrder = ['r1', 'r3', 'r5', 'r2', 'r4', 'r0'];
  const actualOrder = body.checkIns.map((r) => r.headline);
  assert.deepEqual(actualOrder, expectedOrder);
  // And the createdAt strings are monotonically non-increasing.
  for (let i = 1; i < body.checkIns.length; i++) {
    assert.ok(
      body.checkIns[i - 1].createdAt >= body.checkIns[i].createdAt,
      `row ${i - 1} createdAt (${body.checkIns[i - 1].createdAt}) must be >= row ${i} (${body.checkIns[i].createdAt})`,
    );
  }
});
