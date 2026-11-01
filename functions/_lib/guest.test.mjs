import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../api/auth/guest.js';
import { onRequestGet } from '../health.js';

const secret = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

function setup(demoAccessToken) {
  let queries = 0;
  const env = {
    DEMO_MODE: 'true', DEMO_ACCESS_TOKEN: demoAccessToken, SESSION_SECRET: secret(),
    DB: { prepare() { queries++; return { bind() { return this; }, async first() { return { id: 'demo-org' }; }, async run() {} }; } },
  };
  return { env, queries: () => queries };
}

function request(token) {
  return new Request('https://example.test/api/auth/guest', {
    method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test('unconfigured, absent, or incorrect demo access never touches D1', async () => {
  for (const [configured, supplied] of [[undefined, secret()], [secret(), undefined], [secret(), secret()]]) {
    const state = setup(configured);
    const response = await onRequestPost({ env: state.env, request: request(supplied) });
    assert.equal(response.status, 403);
    assert.equal(state.queries(), 0);
  }
});

test('valid demo access creates a guest session', async () => {
  const token = secret();
  const state = setup(token);
  const response = await onRequestPost({ env: state.env, request: request(token) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /^resona_session=/);
  assert.equal(state.queries(), 2);
});

test('missing session configuration fails before creating a guest', async () => {
  const token = secret();
  const state = setup(token);
  state.env.SESSION_SECRET = undefined;
  const response = await onRequestPost({ env: state.env, request: request(token) });
  assert.equal(response.status, 503);
  assert.equal(state.queries(), 0);
});

test('health advertises guest mode only when securely configured', async () => {
  assert.equal((await onRequestGet({ env: setup(undefined).env }).json()).demo, false);
  assert.equal((await onRequestGet({ env: setup(secret()).env }).json()).demo, true);
});

test('health advertises Codex reports only with a secure configured service', async () => {
  const state = setup(secret());
  assert.equal((await onRequestGet({ env: state.env }).json()).codexAnalytics, false);
  state.env.CODEX_ANALYTICS_URL = 'http://example.test/api/codex-analysis';
  state.env.CODEX_ACCESS_TOKEN = secret();
  assert.equal((await onRequestGet({ env: state.env }).json()).codexAnalytics, false);
  state.env.CODEX_ANALYTICS_URL = 'https://example.test/api/codex-analysis';
  assert.equal((await onRequestGet({ env: state.env }).json()).codexAnalytics, true);
});

const sqlite = await import('node:sqlite').catch(() => null);
test('concurrent authorized requests cannot exceed the permanent demo cap', { skip: !sqlite }, async () => {
  const database = new sqlite.DatabaseSync(':memory:');
  database.exec(`CREATE TABLE orgs (id TEXT PRIMARY KEY, slug TEXT UNIQUE, name TEXT, created_at TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, org_id TEXT, email TEXT, created_at TEXT);
    INSERT INTO orgs VALUES ('demo-org', 'demo', 'Demo', 'now');
    INSERT INTO orgs VALUES ('other-org', 'other', 'Other', 'now');
    INSERT INTO users VALUES ('member', 'demo-org', 'member@example.test', 'now');`);
  const insertOther = database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 30; i++) insertOther.run(`other-${i}`, 'other-org', `guest-${i}@demo.local`, 'now');
  const token = secret();
  const state = setup(token);
  state.env.DB = {
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return database.prepare(sql).get(...params) || null; },
        async run() { return database.prepare(sql).run(...params); },
      };
    },
  };
  const responses = await Promise.all(Array.from({ length: 40 }, () => onRequestPost({ env: state.env, request: request(token) })));
  assert.equal(responses.filter((response) => response.status === 200).length, 25);
  assert.equal(responses.filter((response) => response.status === 429).length, 15);
  assert.match((await responses.find((response) => response.status === 429).json()).error, /demo is full/i);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users WHERE org_id = 'demo-org' AND email GLOB 'guest-*@demo.local'").get().count, 25);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users WHERE org_id = 'other-org'").get().count, 30);
  database.close();
});
