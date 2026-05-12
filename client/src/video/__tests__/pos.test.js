import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosSignal } from '../pos.js';

// Synthesise 30 s of 30 fps RGB samples for one ROI with a 1.2 Hz pulse
// modulating the green channel by 0.5%. R and B carry only DC.
function syntheticRgb({ pulseHz = 1.2, fps = 30, durationSec = 30, amplitude = 0.005 }) {
  const n = fps * durationSec;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const beat = amplitude * Math.sin(2 * Math.PI * pulseHz * t);
    r[i] = 0.55;
    g[i] = 0.50 + beat;
    b[i] = 0.40;
  }
  return { r, g, b };
}

function dominantFrequencyHz(signal, fps) {
  // Tiny DFT over 0.7-4 Hz, brute force, for test-only.
  const n = signal.length;
  let bestHz = 0;
  let bestMag = -Infinity;
  for (let hz = 0.7; hz <= 4.0; hz += 0.01) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      re += signal[i] * Math.cos(-2 * Math.PI * hz * t);
      im += signal[i] * Math.sin(-2 * Math.PI * hz * t);
    }
    const mag = re * re + im * im;
    if (mag > bestMag) { bestMag = mag; bestHz = hz; }
  }
  return bestHz;
}

test('POS extracts a 1.2 Hz pulse from synthetic green-modulated RGB', () => {
  const { r, g, b } = syntheticRgb({ pulseHz: 1.2 });
  const fps = 30;
  const s = computePosSignal({ r, g, b, fps, windowSec: 1.6 });
  assert.equal(s.length, r.length);
  const peakHz = dominantFrequencyHz(s, fps);
  assert.ok(Math.abs(peakHz - 1.2) < 0.05, `expected ~1.2 Hz, got ${peakHz.toFixed(3)}`);
});
