import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from './index.js';
import { pool, migrate } from './db.js';
import { resetEmailLog, readEmailLog } from './email.js';

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

function req(method, urlPath, { body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionCookie(res) {
  const hit = res.headers.getSetCookie().find((c) => c.startsWith('resona_session='));
  assert.ok(hit, 'no resona_session cookie set');
  return hit.split(';')[0];
}

async function provisionUser(email) {
  const { rows } = await pool.query(
    "INSERT INTO orgs (slug, name) VALUES ('http-test', 'HTTP Test') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
  );
  await pool.query(
    `INSERT INTO users (org_id, email) VALUES ($1, $2) ON CONFLICT (lower(email)) DO NOTHING`,
    [rows[0].id, email],
  );
}

async function login(email) {
  resetEmailLog();
  const r1 = await req('POST', '/api/auth/request', { body: { email } });
  assert.equal(r1.status, 200);
  const log = readEmailLog();
  const code = log.at(-1).text.match(/\b(\d{6})\b/)[1];
  const r2 = await req('POST', '/api/auth/verify', { body: { email, code } });
  assert.equal(r2.status, 200);
  return sessionCookie(r2);
}

test('GET /api/me without a cookie returns 401', async () => {
  const res = await req('GET', '/api/me');
  assert.equal(res.status, 401);
});

test('POST /api/analyze-blow without a cookie returns 401 (no LLM call)', async () => {
  const res = await req('POST', '/api/analyze-blow', { body: { features: {} } });
  assert.equal(res.status, 401);
});

test('auth/request for an unknown email returns 200 and sends nothing', async () => {
  resetEmailLog();
  const res = await req('POST', '/api/auth/request', { body: { email: 'nobody@nowhere.test' } });
  assert.equal(res.status, 200);
  const log = readEmailLog();
  assert.equal(log.length, 0, 'no email should be sent for an unknown address');
});

test('login flow issues a session that authorises /api/me', async () => {
  const email = 'http-flow@example.com';
  await provisionUser(email);
  const cookie = await login(email);
  const me = await req('GET', '/api/me', { cookie });
  assert.equal(me.status, 200);
  const { user } = await me.json();
  assert.equal(user.email, email);
});

test('PATCH /api/me applies valid fields and ignores invalid ones', async () => {
  const email = 'http-patch@example.com';
  await provisionUser(email);
  const cookie = await login(email);
  const res = await req('PATCH', '/api/me', {
    cookie,
    body: { name: 'Valid Name', heightCm: 5000, sex: 'female' },
  });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.name, 'Valid Name');
  assert.equal(user.sex, 'female');
  assert.equal(user.height_cm, null, 'out-of-range heightCm must be rejected');
});

test('analyze-blow with an incomplete profile returns 400 before the LLM', async () => {
  const email = 'http-incomplete@example.com';
  await provisionUser(email);
  const cookie = await login(email);
  const res = await req('POST', '/api/analyze-blow', {
    cookie,
    body: { features: { durationSec: 4.5 } },
  });
  assert.equal(res.status, 400);
});
