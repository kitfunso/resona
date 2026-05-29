import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBlow, analyzeHeart, analyzeNeuro, getCheckIns, getSessionId } from '../api.js';

// Privacy + behaviour tests for the API client (audit TEST-3). The headline
// guarantee is the privacy boundary: only extracted NUMERIC features ever leave
// the browser. These assert the request bodies carry exactly the allowed keys
// and no raw-capture payload, using a mocked fetch (no DOM, no network).

// api.js touches localStorage (session id) + global fetch in node.
globalThis.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
})();

function captureFetch(captured, { ok = true, status = 200 } = {}) {
  globalThis.fetch = async (path, opts) => {
    captured.path = path;
    captured.opts = opts;
    captured.body = JSON.parse(opts.body);
    return { ok, status, json: async () => ({ ok: true }), text: async () => '' };
  };
}

const ALLOWED_BLOW = new Set(['features', 'estimate', 'demographics', 'sessionId']);
const ALLOWED_HEART = new Set(['heart', 'demographics', 'sessionId']);
// Keys that would indicate raw capture data crossing the boundary.
const RAW_KEYS = ['audio', 'samples', 'pcm', 'waveform', 'frames', 'rgb', 'video', 'imageData', 'buffer', 'blob'];

test('analyzeBlow sends only the numeric feature payload, no raw capture data', async () => {
  const cap = {};
  captureFetch(cap);
  await analyzeBlow({
    features: { peakEnv: 0.5, rmsEnergy: 0.2, activeSec05: 4.1, durationSec: 6 },
    estimate: { fev1: 3.2, fvc: 4.1, pef: 7.5, percentPredicted: { fev1: 95 } },
    demographics: { ageYears: 30, sex: 'male', heightCm: 175 },
  });
  assert.equal(cap.path, '/api/analyze-blow');
  assert.equal(cap.opts.method, 'POST');
  assert.equal(cap.opts.credentials, 'include');
  for (const k of Object.keys(cap.body)) {
    assert.ok(ALLOWED_BLOW.has(k), `unexpected top-level key in blow payload: ${k}`);
  }
  const flat = JSON.stringify(cap.body);
  for (const raw of RAW_KEYS) {
    assert.ok(!flat.includes(`"${raw}"`), `raw-capture key leaked across the boundary: ${raw}`);
  }
  // Body must be pure JSON (no binary): round-trips cleanly.
  assert.deepEqual(JSON.parse(JSON.stringify(cap.body)), cap.body);
});

test('analyzeHeart sends only the heart feature payload', async () => {
  const cap = {};
  captureFetch(cap);
  await analyzeHeart({
    heart: { hrBpm: 72, hrvRmssdMs: 40, snr: 3.1 },
    demographics: { ageYears: 30, sex: 'male' },
  });
  assert.equal(cap.path, '/api/analyze-heart');
  for (const k of Object.keys(cap.body)) {
    assert.ok(ALLOWED_HEART.has(k), `unexpected top-level key in heart payload: ${k}`);
  }
});

test('every analyze call carries a stable per-device sessionId', async () => {
  const a = getSessionId();
  const b = getSessionId();
  assert.equal(a, b, 'session id is stable across calls');
  assert.ok(typeof a === 'string' && a.length > 0);

  const cap = {};
  captureFetch(cap);
  await analyzeHeart({ heart: { hrBpm: 70 }, demographics: {} });
  assert.equal(cap.body.sessionId, a, 'request carries the persisted session id');
});

test('postJson retries once on a network error, then succeeds', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('fetch failed');
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' };
  };
  const out = await analyzeHeart({ heart: { hrBpm: 70 }, demographics: {} });
  assert.equal(calls, 2, 'should retry exactly once');
  assert.deepEqual(out, { ok: true });
});

test('postJson surfaces a non-ok HTTP response as an error', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({}),
    text: async () => 'bad request',
  });
  await assert.rejects(
    analyzeHeart({ heart: { hrBpm: 70 }, demographics: {} }),
    /HTTP 400/,
  );
});

test('analyzeNeuro sends only tremor/gait/demographics, no raw motion stream', async () => {
  const cap = {};
  captureFetch(cap);
  await analyzeNeuro({
    tremor: { dominantFrequencyHz: 6.2, classification: 'physiological', bands: { low: 0.1 } },
    gait: { stepsDetected: 10, cadence: 100, stridesCv: 0.1 },
    demographics: { ageYears: 30, sex: 'male' },
  });
  assert.equal(cap.path, '/api/analyze-neuro');
  const ALLOWED_NEURO = new Set(['tremor', 'gait', 'demographics']);
  for (const k of Object.keys(cap.body)) {
    assert.ok(ALLOWED_NEURO.has(k), `unexpected top-level key in neuro payload: ${k}`);
  }
  const flat = JSON.stringify(cap.body);
  for (const raw of RAW_KEYS) {
    assert.ok(!flat.includes(`"${raw}"`), `raw-capture key leaked across the boundary: ${raw}`);
  }
});

test('getCheckIns GETs the history endpoint and returns the parsed body', async () => {
  let calledPath = null;
  let calledOpts = null;
  globalThis.fetch = async (path, opts) => {
    calledPath = path;
    calledOpts = opts;
    return { ok: true, status: 200, json: async () => ({ checkIns: [{ id: '1' }], limit: 50, truncated: false }) };
  };
  const data = await getCheckIns(50);
  assert.equal(calledPath, '/api/me/check-ins?limit=50');
  assert.equal(calledOpts.credentials, 'include');
  assert.ok(calledOpts.method === undefined || calledOpts.method === 'GET', 'must be a GET');
  assert.equal(data.checkIns.length, 1);
});

test('getCheckIns throws kind=auth-expired on 401 (distinct from network)', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(getCheckIns(50), (err) => err.kind === 'auth-expired');
});

test('getCheckIns throws kind=network on a non-401 failure', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(getCheckIns(50), (err) => err.kind === 'network');
});
