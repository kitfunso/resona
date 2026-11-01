import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { AnalysisQuota, handleRequest, validateReadings } from './index.mjs';

const token = 'a'.repeat(40);
const codexToken = 'b'.repeat(40);
const readings = { soundAboveRelativeThresholdSeconds: 5, breathRms: 0.2, walkingCadence: 110, stepsDetected: 15 };

function fixture() {
  let attempts = 0;
  const sql = { exec(query, limit) {
    if (query.startsWith('CREATE')) return { toArray: () => [] };
    assert.match(query, /WHERE attempts < \? RETURNING attempts/);
    assert.equal(limit, 24);
    const rows = attempts < limit ? [{ attempts: ++attempts }] : [];
    return { toArray: () => rows };
  } };
  const quota = new AnalysisQuota({ storage: { sql } });
  const env = {
    SENSOR_ACCESS_TOKEN: token, CODEX_ACCESS_TOKEN: codexToken, OPENAI_API_KEY: 'mock-provider-key',
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
  const results = await Promise.all(Array.from({ length: 28 }, () => handleRequest(request(), env, fetchStub)));
  assert.equal(results.filter((result) => result.status === 200).length, 24);
  assert.equal(results.filter((result) => result.status === 429).length, 4);
  assert.equal(attempts(), 24);
  assert.equal(calls, 24);
});

test('provider failures count as attempts and are never retried', async () => {
  const { env, attempts } = fixture();
  let calls = 0;
  const fetchStub = async () => { calls++; throw new Error('mock provider failed'); };
  for (let i = 0; i < 24; i++) assert.equal((await handleRequest(request(), env, fetchStub)).status, 503);
  assert.equal((await handleRequest(request(), env, fetchStub)).status, 429);
  assert.equal(attempts(), 24);
  assert.equal(calls, 24);
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

function codexRequest(body, auth = codexToken, contentType = 'application/json') {
  return new Request('https://example.test/api/codex-analysis', {
    method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': contentType }, body: JSON.stringify(body),
  });
}

function codexProvider(action = 'none') {
  return async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ action }) }] }] });
}

test('Codex route rejects unauthorised and malformed input before reserving quota', async () => {
  const { env, attempts } = fixture();
  let calls = 0;
  const fetchStub = async () => { calls++; };
  const body = { modality: 'breath', readings: { rmsEnergy: 0.2 } };
  assert.equal((await handleRequest(codexRequest(body, token), env, fetchStub)).status, 401);
  assert.equal((await handleRequest(codexRequest(body, codexToken, 'text/plain'), env, fetchStub)).status, 415);
  assert.equal((await handleRequest(codexRequest({ ...body, rawAudio: [1] }), env, fetchStub)).status, 400);
  assert.equal((await handleRequest(codexRequest({ junk: 'x'.repeat(1500) }), env, fetchStub)).status, 400);
  assert.equal((await handleRequest(codexRequest(body), { ...env, CODEX_ACCESS_TOKEN: '' }, fetchStub)).status, 503);
  assert.equal(calls, 0);
  assert.equal(attempts(), 0);
});

test('Codex model receives only bounded numeric readings and returns the requested module report', async () => {
  const examples = [
    [{ modality: 'breath', readings: { rmsEnergy: 0.2, activeSec10: 4 } }, 'retry_quiet', /4\.0 seconds/],
    [{ modality: 'motion', readings: { stepsDetected: 10, cadence: 110 } }, 'repeat_walk', /110 steps per minute/],
    [{ modality: 'heart', readings: { hrBpm: 72, durationSec: 30 } }, 'retry_light', /72 beats per minute/],
  ];
  for (const [body, action, expected] of examples) {
    const { env, attempts } = fixture();
    const fetchStub = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const sent = JSON.parse(options.body);
      assert.equal(sent.model, 'gpt-5.3-codex');
      assert.equal(sent.reasoning.effort, 'low');
      assert.equal(sent.max_output_tokens, 768);
      assert.equal(sent.store, false);
      assert.deepEqual(JSON.parse(sent.input), body);
      assert.equal(sent.tools, undefined);
      return codexProvider(action)();
    };
    const result = await handleRequest(codexRequest(body), env, fetchStub);
    assert.equal(result.status, 200);
    const report = await result.json();
    assert.equal(report.source, 'codex');
    assert.match(report.interpretation, expected);
    assert.equal(attempts(), 1);
  }
});

test('Codex rejects malformed output and never retries provider failures', async () => {
  const body = { modality: 'heart', readings: { hrBpm: 72 } };
  for (const fetchStub of [codexProvider('diagnosis'), async () => Response.json({ status: 'incomplete', output: [] }), async () => new Response('', { status: 500 }), async () => { throw new Error('offline'); }]) {
    const { env, attempts } = fixture();
    assert.equal((await handleRequest(codexRequest(body), env, fetchStub)).status, 503);
    assert.equal(attempts(), 1);
  }
});

test('Codex and the earlier sensor demo share a single durable quota', async () => {
  const { env, attempts } = fixture();
  for (let i = 0; i < 23; i++) assert.equal((await handleRequest(request(), env, provider())).status, 200);
  assert.equal((await handleRequest(codexRequest({ modality: 'breath', readings: { rmsEnergy: 0.2 } }), env, codexProvider())).status, 200);
  assert.equal((await handleRequest(codexRequest({ modality: 'heart', readings: { hrBpm: 72 } }), env, codexProvider())).status, 429);
  assert.equal(attempts(), 24);
});

test('failure logs contain only generated IDs and safe categories and statuses', async () => {
  const body = { modality: 'heart', readings: { hrBpm: 72 } };
  const events = [];
  const secretMarker = 'sensitive-demo-marker';
  const { env } = fixture();
  env.OPENAI_API_KEY = secretMarker;
  const logger = (event) => events.push(event);
  const rejected = await handleRequest(codexRequest(body), env, async () => new Response(secretMarker, { status: 403 }), logger);
  const malformed = await handleRequest(codexRequest(body), env, async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: secretMarker }] }] }), logger);
  const unavailable = await handleRequest(codexRequest(body), env, async () => { throw new Error(secretMarker); }, logger);
  const denied = await handleRequest(codexRequest(body, token), env, codexProvider(), logger);
  assert.equal(rejected.status, 503);
  assert.equal(malformed.status, 503);
  assert.equal(unavailable.status, 503);
  assert.equal(denied.status, 401);
  assert.deepEqual(events.map(({ category, status }) => ({ category, status })), [
    { category: 'provider_http', status: 403 },
    { category: 'provider_output', status: undefined },
    { category: 'provider_network', status: undefined },
    { category: 'access_denied', status: 401 },
  ]);
  for (const event of events) {
    assert.match(event.requestId, /^[0-9a-f-]{36}$/);
    assert.ok(Object.keys(event).every((key) => ['requestId', 'category', 'status'].includes(key)));
  }
  assert.doesNotMatch(JSON.stringify(events), /sensitive-demo-marker|hrBpm|Bearer/);
});

test('Worker entry point ignores Cloudflare execution context as a provider', async (t) => {
  t.mock.method(globalThis, 'fetch', provider());
  const result = await worker.fetch(request(), fixture().env, { waitUntil() {} });
  assert.equal(result.status, 200);
});
