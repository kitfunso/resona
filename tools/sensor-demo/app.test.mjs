import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createAnalyticsServer, validateReadings } from './app.mjs';

const accessToken = 'a'.repeat(43);
const readings = { soundAboveRelativeThresholdSeconds: 6, breathRms: 0.12, walkingCadence: 100, stepsDetected: 15 };
const goodReply = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"nextAction":"repeat_walk"}' }] }] };

async function start(t, fetchImpl, staticDir) {
  const server = createAnalyticsServer({ apiKey: 'test-only', accessToken, fetchImpl, staticDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function post(base, body = readings, token = accessToken) {
  return fetch(`${base}/api/sensor-analysis`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('validates finite ranges and rejects unexpected or raw data', () => {
  assert.deepEqual(validateReadings({ ...readings, breathRms: null }), { soundAboveRelativeThresholdSeconds: 6, walkingCadence: 100, stepsDetected: 15 });
  for (const invalid of [{}, { breathRms: Infinity }, { walkingCadence: -1 }, { stepsDetected: 1.5 }, { ...readings, rawAudio: [] }, { breathRms: '0.1' }]) {
    assert.equal(validateReadings(invalid), null);
  }
});

test('requires a strong token and never calls the provider on invalid input', async (t) => {
  let calls = 0;
  const base = await start(t, async () => { calls += 1; return { ok: true, json: async () => goodReply }; });
  assert.equal((await post(base, readings, 'wrong')).status, 401);
  assert.equal((await post(base, { ...readings, samples: [1] })).status, 400);
  const large = await fetch(`${base}/api/sensor-analysis`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ breathRms: 'x'.repeat(2000) }) });
  assert.equal(large.status, 400);
  assert.equal(calls, 0);
});

test('sends only numerical features, requests no storage, and returns model text', async (t) => {
  let sent;
  const base = await start(t, async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => goodReply };
  });
  const response = await post(base);
  assert.equal(response.status, 200);
  assert.match((await response.json()).analysis, /approximate/);
  assert.equal(sent.store, false);
  assert.equal(sent.model, 'gpt-6-luna');
  assert.equal(sent.max_output_tokens, 180);
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(JSON.parse(sent.input), readings);
});

test('reserves a strict quota before concurrently calling the provider', async (t) => {
  let calls = 0;
  const base = await start(t, async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 30)); return { ok: true, json: async () => goodReply }; });
  const responses = await Promise.all(Array.from({ length: 6 }, () => post(base)));
  assert.equal(calls, 3);
  assert.equal(responses.filter((response) => response.status === 200).length, 3);
  assert.equal(responses.filter((response) => response.status === 429).length, 3);
});

test('fails closed on provider errors or output outside the fixed choices', async (t) => {
  let calls = 0;
  const base = await start(t, async () => {
    calls += 1;
    if (calls === 1) throw new Error('network');
    return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Your lungs are healthy.' }] }] }) };
  });
  for (let i = 0; i < 2; i += 1) {
    const response = await post(base);
    assert.equal(response.status, 503);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(calls, 2);
});

test('fails closed when the chosen action does not fit the available readings', async (t) => {
  const base = await start(t, async () => ({ ok: true, json: async () => goodReply }));
  const response = await post(base, { breathRms: 0.1 });
  assert.equal(response.status, 503);
});

test('survives a client disconnecting midway through the JSON request', async (t) => {
  let calls = 0;
  const base = await start(t, async () => { calls += 1; return { ok: true, json: async () => goodReply }; });
  const port = Number(new URL(base).port);
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`POST /api/sensor-analysis HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${accessToken}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 0);
  assert.equal((await post(base)).status, 200);
  assert.equal(calls, 1);
});

test('serves only the prepared entry and allowed assets, never traversal or other files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'resona-static-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'sensor.html'), '<h1>Sensor</h1>');
  await writeFile(join(dir, 'assets', 'bundle.js'), 'export {};');
  await writeFile(join(dir, 'private.txt'), 'private');
  const base = await start(t, async () => { throw new Error('unexpected call'); }, dir);
  assert.match(await (await fetch(`${base}/sensor`)).text(), /Sensor/);
  assert.equal((await fetch(`${base}/assets/bundle.js`)).status, 200);
  assert.equal((await fetch(`${base}/private.txt`)).status, 404);
  const traversalStatus = await new Promise((resolve, reject) => {
    const endpoint = new URL(base);
    const req = request({ hostname: endpoint.hostname, port: endpoint.port, path: '/assets/%2e%2e/private.txt' }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(traversalStatus, 404);
});
