import test from 'node:test';
import assert from 'node:assert/strict';
import { getCodexReport, pickReadings, readAnalysisBody } from './demo-analysis.js';

test('analysis bodies are bounded and must contain valid JSON', async () => {
  const request = (body) => new Request('https://example.test/', { method: 'POST', body });
  assert.deepEqual(await readAnalysisBody(request('{"heart":{"hrBpm":72}}')), { heart: { hrBpm: 72 } });
  assert.equal(await readAnalysisBody(request('{')), null);
  assert.equal(await readAnalysisBody(request(JSON.stringify({ x: 'x'.repeat(1024) }))), null);
  assert.equal(await readAnalysisBody(new Request('https://example.test/')), null);
});

test('only bounded numerical sensor features are accepted', () => {
  assert.deepEqual(pickReadings('breath', [{ rmsEnergy: 0.2, activeSec10: null }]), { rmsEnergy: 0.2 });
  assert.deepEqual(pickReadings('breath', [{ peakEnv: 2.06 }]), { peakEnv: 2.06 });
  for (const value of [{ rawAudio: [1] }, { rmsEnergy: Infinity }, { rmsEnergy: 11 }, { name: 'person' }]) assert.equal(pickReadings('breath', [value]), null);
  assert.equal(pickReadings('motion', [{ stepsDetected: 2.5 }]), null);
  assert.equal(pickReadings('heart', [{ hrBpm: -1 }]), null);
  assert.equal(pickReadings('heart', [{ hrBpm: 72, hrvRmssdMs: 40 }]), null);
});

test('provider is called only with the chosen numeric features', async () => {
  const env = { CODEX_ANALYTICS_URL: 'https://example.test/api/codex-analysis', CODEX_ACCESS_TOKEN: 'test-token' };
  const expected = { headline: 'Snapshot', interpretation: 'Experimental reading.', actions: [], source: 'codex' };
  let calls = 0;
  const provider = async (url, options) => {
    calls++;
    assert.equal(url.toString(), env.CODEX_ANALYTICS_URL);
    assert.deepEqual(JSON.parse(options.body), { modality: 'breath', readings: { rmsEnergy: 0.2 } });
    return Response.json(expected);
  };
  assert.deepEqual(await getCodexReport(env, 'breath', { rmsEnergy: 0.2 }, provider), expected);
  assert.equal(calls, 1);
});

test('missing configuration and provider failure yield a labelled local fallback', async () => {
  assert.equal((await getCodexReport({}, 'breath', { rmsEnergy: 0.2 })).source, 'fallback');
  const env = { CODEX_ANALYTICS_URL: 'https://example.test/api/codex-analysis', CODEX_ACCESS_TOKEN: 'test-token' };
  assert.equal((await getCodexReport(env, 'breath', { rmsEnergy: 0.2 }, async () => new Response('', { status: 503 }))).source, 'fallback');
  assert.equal((await getCodexReport(env, 'breath', { rmsEnergy: 0.2 }, async () => { throw new Error('failed'); })).source, 'fallback');
});
