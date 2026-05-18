import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, migrate } from './db.js';
import { requestCode, verifyCode, issueSession, verifySession } from './auth.js';
import { resetEmailLog, readEmailLog } from './email.js';

const TEST_EMAIL = 'auth-test@example.com';

test.before(async () => {
  await migrate();
  // Provision an org + user we can authenticate as.
  const { rows: orgs } = await pool.query(
    "INSERT INTO orgs (slug, name) VALUES ('test-co', 'Test Co') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
  );
  const orgId = orgs[0].id;
  await pool.query(
    `INSERT INTO users (org_id, email) VALUES ($1, $2)
     ON CONFLICT (lower(email)) DO NOTHING`,
    [orgId, TEST_EMAIL],
  );
});

test.beforeEach(() => {
  resetEmailLog();
});

test('requestCode emails a 6-digit code to a known user', async () => {
  await requestCode(TEST_EMAIL);
  const log = readEmailLog();
  assert.equal(log.length, 1);
  assert.match(log[0].text, /\b\d{6}\b/);
});

test('verifyCode succeeds with correct code, returns user', async () => {
  await requestCode(TEST_EMAIL);
  const log = readEmailLog();
  const code = log[0].text.match(/\b(\d{6})\b/)[1];
  const result = await verifyCode(TEST_EMAIL, code);
  assert.ok(result.userId);
  assert.equal(result.email, TEST_EMAIL);
});

test('verifyCode rejects wrong code', async () => {
  await requestCode(TEST_EMAIL);
  await assert.rejects(verifyCode(TEST_EMAIL, '000000'), /invalid|expired/i);
});

test('verifyCode is single-use', async () => {
  await requestCode(TEST_EMAIL);
  const log = readEmailLog();
  const code = log[0].text.match(/\b(\d{6})\b/)[1];
  await verifyCode(TEST_EMAIL, code);
  await assert.rejects(verifyCode(TEST_EMAIL, code), /invalid|expired/i);
});

test('issueSession + verifySession round-trip', async () => {
  const token = await issueSession({ userId: 'abc-123', orgId: 'org-1' });
  const payload = await verifySession(token);
  assert.equal(payload.userId, 'abc-123');
  assert.equal(payload.orgId, 'org-1');
});

test.after(async () => {
  await pool.end();
});
