// Robustness / failure-mode tests for the rPPG heart pipeline.
//
// The existing pos/features tests prove the DSP recovers a *clean* synthetic
// sine. These tests push the pipeline toward real-world conditions it will
// actually meet on a phone:
//   - sensor/quantisation noise at varying SNR
//   - low-frequency baseline wander (lighting/skin-tone drift)
//   - non-uniform frame timing (rAF jitter + dropped frames)
//
// The single most important assertion for a *health* product is the safety
// one: on signal too poor to trust, the pipeline must NOT return a confident
// 'good' grade with a wrong number. It should grade 'fair'/'poor' or flag
// low_snr. These tests encode that contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHeartFeatures } from '../features.js';

// Deterministic PRNG (mulberry32) so noise is reproducible -> no flaky tests.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box-Muller standard normal from a uniform generator.
function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Build a realistic-ish rPPG sample object.
//   bpm          true heart rate
//   acAmp        pulsatile amplitude on green (fraction of DC ~0.5)
//   noiseStd     per-channel white-noise std (sensor/quantisation/motion proxy)
//   wanderAmp    low-freq (0.1 Hz) baseline drift amplitude (lighting/skin)
//   jitterMs     stdev of per-frame timestamp jitter (rAF irregularity)
//   dropRate     fraction of frames randomly dropped (non-uniform sampling)
function makeRppg({
  bpm, fps = 30, durationSec = 30,
  acAmp = 0.01, noiseStd = 0, wanderAmp = 0, jitterMs = 0, dropRate = 0, seed = 1,
}) {
  const rand = rng(seed);
  const pulseHz = bpm / 60;
  const nominalN = Math.round(fps * durationSec);
  const t = [];
  const fr = [], fg = [], fb = [];
  const cr = [], cg = [], cb = [];
  let clock = 0;
  for (let i = 0; i < nominalN; i++) {
    clock += (1000 / fps) + (jitterMs ? gauss(rand) * jitterMs : 0);
    if (clock < 0) clock = 0;
    if (dropRate && rand() < dropRate) continue; // dropped frame
    const sec = clock / 1000;
    const beat = acAmp * Math.sin(2 * Math.PI * pulseHz * sec);
    const wander = wanderAmp ? wanderAmp * Math.sin(2 * Math.PI * 0.1 * sec) : 0;
    // Green carries most of the pulse; R/B mostly DC. All share wander + noise.
    const gN = noiseStd ? gauss(rand) * noiseStd : 0;
    const rNz = noiseStd ? gauss(rand) * noiseStd : 0;
    const bNz = noiseStd ? gauss(rand) * noiseStd : 0;
    t.push(clock);
    fr.push(0.55 + wander + rNz);
    fg.push(0.50 + beat + wander + gN);
    fb.push(0.40 + wander + bNz);
    // Cheeks: same pulse, independent noise draw.
    cr.push(0.55 + wander + (noiseStd ? gauss(rand) * noiseStd : 0));
    cg.push(0.50 + beat + wander + (noiseStd ? gauss(rand) * noiseStd : 0));
    cb.push(0.40 + wander + (noiseStd ? gauss(rand) * noiseStd : 0));
  }
  const f32 = (a) => Float32Array.from(a);
  return {
    samples: {
      t: f32(t),
      forehead: { r: f32(fr), g: f32(fg), b: f32(fb) },
      cheeks: { r: f32(cr), g: f32(cg), b: f32(cb) },
    },
    durationSec,
  };
}

// --- Accuracy under realistic-but-recoverable conditions -------------------

test('recovers HR across a sweep (50/72/100/130 bpm) with mild noise + fps jitter', () => {
  for (const bpm of [50, 72, 100, 130]) {
    const { samples, durationSec } = makeRppg({
      bpm, acAmp: 0.012, noiseStd: 0.0008, jitterMs: 6, seed: bpm,
    });
    const out = extractHeartFeatures({ samples, durationSec });
    assert.ok(
      out.hrBpm != null && Math.abs(out.hrBpm - bpm) <= 5,
      `bpm=${bpm}: got ${out.hrBpm?.toFixed(1)} (grade ${out.grade}, reasons ${JSON.stringify(out.reasons)})`,
    );
    assert.notEqual(out.grade, 'poor', `bpm=${bpm} graded poor on a recoverable signal`);
  }
});

test('non-uniform timestamps + 10% dropped frames still recover ~72 bpm', () => {
  const { samples, durationSec } = makeRppg({
    bpm: 72, acAmp: 0.012, noiseStd: 0.0006, jitterMs: 10, dropRate: 0.10, seed: 7,
  });
  const out = extractHeartFeatures({ samples, durationSec });
  assert.ok(
    out.hrBpm != null && Math.abs(out.hrBpm - 72) <= 5,
    `got ${out.hrBpm?.toFixed(1)} bpm (grade ${out.grade}, reasons ${JSON.stringify(out.reasons)})`,
  );
});

test('0.1 Hz baseline wander 5x the pulse amplitude is rejected; HR still ~66 bpm', () => {
  const { samples, durationSec } = makeRppg({
    bpm: 66, acAmp: 0.01, wanderAmp: 0.05, noiseStd: 0.0005, jitterMs: 5, seed: 66,
  });
  const out = extractHeartFeatures({ samples, durationSec });
  assert.ok(
    out.hrBpm != null && Math.abs(out.hrBpm - 66) <= 5,
    `wander not rejected: got ${out.hrBpm?.toFixed(1)} bpm (grade ${out.grade}, reasons ${JSON.stringify(out.reasons)})`,
  );
});

// --- Safety: do NOT report a confident number on untrustworthy signal ------

test('SAFETY: in-band motion interference must not produce a confident wrong HR', () => {
  // True pulse at 60 bpm (1.0 Hz) plus a stronger competing in-band tone at
  // 96 bpm (1.6 Hz) — a proxy for rhythmic motion/respiration artifact, the
  // real-world threat (unlike white noise, which integrates out). The pipeline
  // must either lock to the true 60 bpm or refuse to grade 'good'.
  const rand = rng(42);
  const fps = 30, durationSec = 30, n = fps * durationSec;
  const t = [], fr = [], fg = [], fb = [];
  for (let i = 0; i < n; i++) {
    const sec = i / fps + gauss(rand) * 0.003;
    const truePulse = 0.010 * Math.sin(2 * Math.PI * 1.0 * sec);
    const interferer = 0.014 * Math.sin(2 * Math.PI * 1.6 * sec);
    t.push((i / fps) * 1000);
    fr.push(0.55 + interferer * 0.3);
    fg.push(0.50 + truePulse + interferer);
    fb.push(0.40 + interferer * 0.2);
  }
  const f32 = (a) => Float32Array.from(a);
  const samples = { t: f32(t), forehead: { r: f32(fr), g: f32(fg), b: f32(fb) }, cheeks: { r: f32(fr), g: f32(fg), b: f32(fb) } };
  const out = extractHeartFeatures({ samples, durationSec });
  const lockedTrue = out.hrBpm != null && Math.abs(out.hrBpm - 60) <= 8;
  assert.ok(
    lockedTrue || out.grade !== 'good',
    `locked to interferer (hr=${out.hrBpm?.toFixed(1)}, true=60) and graded '${out.grade}' — confident-wrong. reasons=${JSON.stringify(out.reasons)}`,
  );
});

test('SAFETY: pure noise (no pulse) must grade "poor"', () => {
  const { samples, durationSec } = makeRppg({
    bpm: 72, acAmp: 0, noiseStd: 0.01, jitterMs: 8, seed: 999,
  });
  const out = extractHeartFeatures({ samples, durationSec });
  assert.equal(
    out.grade, 'poor',
    `pure noise graded '${out.grade}' (hr=${out.hrBpm?.toFixed(1)}, reasons=${JSON.stringify(out.reasons)}) — should be 'poor'`,
  );
});

test('SAFETY: flat (zero-variance) signal grades poor with no_peak', () => {
  const { samples, durationSec } = makeRppg({ bpm: 72, acAmp: 0, noiseStd: 0, seed: 1 });
  const out = extractHeartFeatures({ samples, durationSec });
  assert.equal(out.grade, 'poor');
  assert.ok(out.reasons.includes('no_peak'), `expected no_peak, got ${JSON.stringify(out.reasons)}`);
});
