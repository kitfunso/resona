import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { AnalysisQuota, handleRequest, validateReadings } from './index.mjs';

const token = 'a'.repeat(40);
const readings = { soundAboveRelativeThresholdSeconds: 5, breathRms: 0.2, walkingCadence: 110, stepsDetected: 15 };

function fixture() {
  let attempts = 0;
  const sql = { exec(query) {
    if (query.startsWith('CREATE')) return { toArray: () => [] };
    assert.match(query, /WHERE attempts < 3 RETURNING attempts/);
    const rows = attempts < 3 ? [{ attempts: ++attempts }] : [];
    return { toArray: () => rows };
  } };
  const quota = new AnalysisQuota({ storage: { sql } });
  const env = {
    SENSOR_ACCESS_TOKEN: token, OPENAI_API_KEY: 'mock-provider-key',
    QUOTA: { idFromName: () => 'single-demo', get: () => ({ fetch: (url, init) => quota.fetch(new Request(url, init)) }) },
    ASSETS: { fetch: (request) => new Response(new URL(request.url).pathname) },
  };
  return { env, attempts: () => attempts };
}

function request(body = readings, auth = token, contentType = 'application/json') {
  return new Request('https://example.test/api/sensor-analysis', {
    method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': contentType }, body: JSON.stringify(body),
  });
}

function provider(action = 'none') {
  return async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ nextAction: action }) }] }] });
}

test('strictly accepts only bounded derived readings', () => {
  assert.deepEqual(validateReadings({ ...readings, breathRms: null }), { soundAboveRelativeThresholdSeconds: 5, walkingCadence: 110, stepsDetected: 15 });
  for (const invalid of [{}, { rawAudio: [1] }, { breathRms: '0.2' }, { walkingCadence: Infinity }, { stepsDetected: 2.5 }, { breathRms: -1 }, { soundAboveRelativeThresholdSeconds: 31 }, { walkingCadence: 301 }]) assert.equal(validateReadings(invalid), null);
});

test('rejects unauthorised, malformed, and oversized requests without reserving quota', async () => {
  const { env, attempts } = fixture();
  assert.equal((await handleRequest(request(readings, 'incorrect'), env, provider())).status, 401);
  assert.equal((await handleRequest(request(readings, token, 'text/plain'), env, provider())).status, 415);
  assert.equal((await handleRequest(request({ ...readings, rawAudio: [1] }), env, provider())).status, 400);
  assert.equal((await handleRequest(request({ junk: 'x'.repeat(1500) }), env, provider())).status, 400);
  assert.equal((await handleRequest(request(), { ...env, SENSOR_ACCESS_TOKEN: '' }, provider())).status, 503);
  assert.equal(attempts(), 0);
});

test('sends only the allowed measurements and returns a fixed nonclinical action', async () => {
  const { env } = fixture();
  let calls = 0;
  const fetchStub = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 180);
    assert.deepEqual(JSON.parse(body.input), readings);
    assert.deepEqual(body.text.format.schema.properties.nextAction.enum, ['repeat_walk', 'quiet_place', 'none']);
    return provider('repeat_walk')();
  };
  const result = await handleRequest(request(), env, fetchStub);
  assert.equal(result.status, 200);
  assert.match((await result.json()).analysis, /^If you repeat the walk/);
  assert.equal(calls, 1);
});

test('a shared durable quota caps concurrent provider attempts', async () => {
  const { env, attempts } = fixture();
  let calls = 0;
  const fetchStub = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 10)); return provider()(); };
  const results = await Promise.all(Array.from({ length: 8 }, () => handleRequest(request(), env, fetchStub)));
  assert.equal(results.filter((result) => result.status === 200).length, 3);
  assert.equal(results.filter((result) => result.status === 429).length, 5);
  assert.equal(attempts(), 3);
  assert.equal(calls, 3);
});

test('provider failures count as attempts and are never retried', async () => {
  const { env, attempts } = fixture();
  let calls = 0;
  const fetchStub = async () => { calls++; throw new Error('mock provider failed'); };
  for (let i = 0; i < 3; i++) assert.equal((await handleRequest(request(), env, fetchStub)).status, 503);
  assert.equal((await handleRequest(request(), env, fetchStub)).status, 429);
  assert.equal(attempts(), 3);
  assert.equal(calls, 3);
});

test('provider output is rejected unless its action is allowed for the readings', async () => {
  for (const [body, action] of [[{ breathRms: 0.1 }, 'repeat_walk'], [readings, 'diagnosis']]) {
    const result = await handleRequest(request(body), fixture().env, provider(action));
    assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(await result.json()), /diagnosis/);
  }
});

test('static routes allow only prepared demo files', async () => {
  const { env } = fixture();
  for (const pathname of ['/', '/sensor', '/sensor.html', '/assets/demo.js', '/assets/demo.css']) {
    assert.equal((await handleRequest(new Request(`https://example.test${pathname}`), env)).status, 200);
  }
  for (const pathname of ['/secret.txt', '/assets/secret.json', '/assets/%2e%2e/secret.js', '/other']) {
    assert.equal((await handleRequest(new Request(`https://example.test${pathname}`), env)).status, 404);
  }
});

test('Worker entry point ignores Cloudflare execution context as a provider', async (t) => {
  t.mock.method(globalThis, 'fetch', provider());
  const result = await worker.fetch(request(), fixture().env, { waitUntil() {} });
  assert.equal(result.status, 200);
});
