import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisPayload, breathReading, walkReading } from './readings.js';

test('a silent breath recording reports unavailable sound instead of a fabricated duration', () => {
  const reading = breathReading(new Float32Array(48000), 48000);
  assert.equal(reading.soundAboveRelativeThresholdSeconds, null);
  assert.equal(reading.breathRms, 0);
});

test('an empty motion signal reports no cadence or step count', () => {
  const samples = Array.from({ length: 120 }, (_, i) => ({ t: i * 16, ax: 0, ay: 0, az: 9.8 }));
  const reading = walkReading({ samples, rate: 60 });
  assert.equal(reading.walkingCadence, null);
  assert.equal(reading.stepsDetected, null);
});

test('analysis request excludes samples and every unrelated property', () => {
  const payload = analysisPayload(
    { soundAboveRelativeThresholdSeconds: 1.5, breathRms: 0.02, pcm: [0.2], name: 'Example' },
    { walkingCadence: 110, stepsDetected: 12, samples: [{ ax: 1 }] },
  );
  assert.deepEqual(payload, { soundAboveRelativeThresholdSeconds: 1.5, breathRms: 0.02, walkingCadence: 110, stepsDetected: 12 });
});
