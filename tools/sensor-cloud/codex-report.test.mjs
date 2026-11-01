import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCodexInput, reportFromCodexCode, codexActionSchema } from './codex-report.mjs';

test('accepts only the agreed finite scalar readings', () => {
  const breath = { modality: 'breath', readings: { rmsEnergy: 0.2, activeSec10: 4, peakEnv: null } };
  assert.deepEqual(validateCodexInput(breath), { modality: 'breath', readings: { rmsEnergy: 0.2, activeSec10: 4 } });
  assert.ok(validateCodexInput({ modality: 'motion', readings: { stepsDetected: 10, cadence: 110, stridesCv: 0.1 } }));
  assert.ok(validateCodexInput({ modality: 'heart', readings: { hrBpm: 70, durationSec: 30 } }));
  assert.ok(validateCodexInput({ modality: 'breath', readings: { rmsEnergy: 1.2, peakEnv: 2.06 } }));
  for (const input of [
    { modality: 'breath', readings: { rawAudio: [1] } },
    { modality: 'motion', readings: { strideTimesMs: [100] } },
    { modality: 'heart', readings: { hrBpm: NaN } },
    { modality: 'motion', readings: { stepsDetected: 1.5 } },
    { modality: 'breath', readings: { activeSec10: 31 } },
    { modality: 'breath', readings: { peakEnv: 10.1 } },
    { modality: 'breath', readings: { peakEnv: null } },
    { modality: 'breath', readings: { peakEnv: 0.1 }, name: 'someone' },
  ]) assert.equal(validateCodexInput(input), null);
});

test('maps only permitted codes to fixed nonclinical reports', () => {
  for (const modality of ['breath', 'motion', 'heart']) {
    const schema = codexActionSchema(modality);
    for (const action of schema.properties.action.enum) {
      const report = reportFromCodexCode(modality, { action });
      assert.equal(report.source, 'codex');
      assert.equal(report.actions.length, 1);
    }
  }
  assert.equal(reportFromCodexCode('breath', { action: 'repeat_walk' }), null);
  assert.equal(reportFromCodexCode('heart', { action: 'none', diagnosis: 'unsafe' }), null);
  assert.equal(reportFromCodexCode('unknown', { action: 'none' }), null);
  assert.equal(reportFromCodexCode('breath', { action: 'toString' }), null);
  assert.equal(validateCodexInput({ modality: '__proto__', readings: { anything: 1 } }), null);
  assert.equal(reportFromCodexCode('motion', { action: 'repeat_walk' }, { dominantFrequencyHz: 5 }), null);
  assert.equal(reportFromCodexCode('motion', { action: 'steady_phone' }, { cadence: 110 }), null);
});
