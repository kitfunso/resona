import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHeartFeatures } from '../features.js';

function synthRgbSeries({ pulseHz = 1.2, fps = 30, durationSec = 30, amplitude = 0.005 }) {
  const n = fps * durationSec;
  const t = new Float32Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = (i / fps) * 1000; // ms
    const beat = amplitude * Math.sin(2 * Math.PI * pulseHz * (i / fps));
    r[i] = 0.55;
    g[i] = 0.50 + beat;
    b[i] = 0.40;
  }
  return { t, r, g, b };
}

test('72 bpm synthetic pulse round-trips to ~72 bpm HR', () => {
  const pulseHz = 72 / 60; // 1.2 Hz
  const { t, r, g, b } = synthRgbSeries({ pulseHz });
  const samples = { t, forehead: { r, g, b }, cheeks: { r, g, b } };
  const out = extractHeartFeatures({ samples, durationSec: 30 });
  assert.ok(Math.abs(out.hrBpm - 72) < 2, `expected ~72 bpm, got ${out.hrBpm.toFixed(2)}`);
  assert.ok(out.beatCount >= 30 && out.beatCount <= 40, `unexpected beat count ${out.beatCount}`);
  assert.ok(out.snr > 1.5, `expected snr > 1.5, got ${out.snr.toFixed(2)}`);
});

test('flat signal grades reasons[] with no_peak', () => {
  const fps = 30;
  const n = fps * 30;
  const t = new Float32Array(n);
  const flat = new Float32Array(n).fill(0.5);
  for (let i = 0; i < n; i++) t[i] = (i / fps) * 1000;
  const samples = { t, forehead: { r: flat, g: flat, b: flat }, cheeks: { r: flat, g: flat, b: flat } };
  const out = extractHeartFeatures({ samples, durationSec: 30 });
  assert.ok(out.reasons.includes('no_peak'), `expected no_peak in ${JSON.stringify(out.reasons)}`);
  assert.equal(out.grade, 'poor', `expected grade 'poor', got '${out.grade}'`);
});
