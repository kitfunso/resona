// Standalone DSP verification for the Resona Heart module (rPPG).
//
// House style: a plain node script like server/test-gpt.js. No test framework.
// Generates synthetic camera samples, runs the pure DSP in client/src/heart/
// rppg.js, and asserts the known pulse frequency is recovered.
//
// Refinement R2: the synthetic frame timestamps are JITTERED (nominal 30 fps
// with random per-frame jitter), not an idealised uniform grid, so the test
// exercises resampleUniform the way a real camera would. The recovered bpm is
// asserted within ~3 bpm (one true 1/T FFT bin) of the known truth.

import { analyseHeart } from '../client/src/heart/rppg.js';

const TWO_PI = 2 * Math.PI;

// Deterministic PRNG so the test is reproducible across runs (mulberry32).
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build ~durationSec of synthetic { r, g, b, t } samples at a jittered ~30 fps.
// A pulse component at pulseHz is injected into all three channels with the
// green channel strongest (real rPPG: green carries the most pulsatile signal),
// on top of a DC skin tone, a slow lighting trend, and per-channel white noise.
function synthPulseSamples({ pulseHz, durationSec, nominalFps, noise, rng }) {
  const samples = [];
  const dcR = 180;
  const dcG = 120;
  const dcB = 110;
  const nominalDtMs = 1000 / nominalFps;
  let t = 0;
  const endMs = durationSec * 1000;

  while (t < endMs) {
    const sec = t / 1000;
    const phase = TWO_PI * pulseHz * sec;
    // Slow lighting trend: a low-amplitude drift across the whole window.
    const trend = 6 * Math.sin(TWO_PI * 0.04 * sec);
    // Pulse amplitudes (digital counts) -- small, like real rPPG.
    const pulse = Math.sin(phase);
    const r = dcR + trend + 0.6 * pulse + noise * (rng() - 0.5);
    const g = dcG + trend + 2.2 * pulse + noise * (rng() - 0.5);
    const b = dcB + trend + 0.9 * pulse + noise * (rng() - 0.5);
    samples.push({ r, g, b, t });
    // Jittered inter-frame gap: nominal +/- up to ~40% of a frame.
    const jitter = (rng() - 0.5) * 0.8 * nominalDtMs;
    t += nominalDtMs + jitter;
  }
  return samples;
}

// Pure-noise samples: DC skin tone + white noise only, no pulse component.
function synthNoiseSamples({ durationSec, nominalFps, noise, rng }) {
  const samples = [];
  const nominalDtMs = 1000 / nominalFps;
  let t = 0;
  const endMs = durationSec * 1000;
  while (t < endMs) {
    samples.push({
      r: 180 + noise * (rng() - 0.5),
      g: 120 + noise * (rng() - 0.5),
      b: 110 + noise * (rng() - 0.5),
      t,
    });
    const jitter = (rng() - 0.5) * 0.8 * nominalDtMs;
    t += nominalDtMs + jitter;
  }
  return samples;
}

// Identical-channel samples: r === g === b, all carrying the same pulse. POS
// demixing of three identical channels cancels to zero (s1 = s2 = 0), so this
// deterministically forces the green-channel fallback path in analyseHeart.
function synthIdenticalChannelSamples({ pulseHz, durationSec, nominalFps, noise, rng }) {
  const samples = [];
  const dc = 140;
  const nominalDtMs = 1000 / nominalFps;
  let t = 0;
  const endMs = durationSec * 1000;
  while (t < endMs) {
    const sec = t / 1000;
    const trend = 6 * Math.sin(TWO_PI * 0.04 * sec);
    const pulse = 2.0 * Math.sin(TWO_PI * pulseHz * sec);
    const v = dc + trend + pulse + noise * (rng() - 0.5);
    samples.push({ r: v, g: v, b: v, t });
    const jitter = (rng() - 0.5) * 0.8 * nominalDtMs;
    t += nominalDtMs + jitter;
  }
  return samples;
}

// Effective rate (the same fps estimate camera.js would report).
function effectiveRate(samples) {
  const span = samples[samples.length - 1].t - samples[0].t;
  return span > 0 ? ((samples.length - 1) / span) * 1000 : 0;
}

let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
    failures++;
  }
}

function main() {
  console.log('Resona rPPG DSP test: synthetic known-frequency signal\n');

  // --- Case 1: a clean pulse at a known frequency ------------------------
  const trueHz = 1.2; // 72 bpm
  const trueBpm = trueHz * 60;
  const rng1 = makeRng(0x5eed1234);
  const pulseSamples = synthPulseSamples({
    pulseHz: trueHz,
    durationSec: 20,
    nominalFps: 30,
    noise: 1.2,
    rng: rng1,
  });
  const pulseResult = analyseHeart({
    samples: pulseSamples,
    rate: effectiveRate(pulseSamples),
  });

  console.log('Case 1 (pulse @ 1.2 Hz = 72 bpm, jittered ~30 fps):');
  console.log(`  detected: bpm=${pulseResult.bpm} quality=${pulseResult.quality} ` +
    `snrDb=${pulseResult.snrDb} dominantHz=${pulseResult.dominantHz} ` +
    `classification=${pulseResult.classification} effectiveFps=${pulseResult.effectiveFps}`);

  // True FFT resolution is 1/T = 1/20 s = 0.05 Hz = 3 bpm. The bar is one bin.
  const bpmError = Math.abs(pulseResult.bpm - trueBpm);
  check(
    'detected bpm within ~3 bpm of truth',
    bpmError <= 3,
    `error=${bpmError.toFixed(1)} bpm (detected ${pulseResult.bpm}, truth ${trueBpm})`,
  );
  check(
    'pulse signal is not flagged invalid',
    pulseResult.quality !== 'invalid',
    `quality=${pulseResult.quality}`,
  );
  check(
    'classification is meaningful on a valid signal',
    pulseResult.classification === 'normal',
    `classification=${pulseResult.classification}`,
  );
  check(
    'output object is frozen',
    Object.isFrozen(pulseResult),
    'analyseHeart must return a frozen object',
  );

  // --- Case 2: pure noise, no pulse --------------------------------------
  const rng2 = makeRng(0xabcd9876);
  const noiseSamples = synthNoiseSamples({
    durationSec: 20,
    nominalFps: 30,
    noise: 6.0,
    rng: rng2,
  });
  const noiseResult = analyseHeart({
    samples: noiseSamples,
    rate: effectiveRate(noiseSamples),
  });

  console.log('\nCase 2 (pure noise, no pulse component):');
  console.log(`  detected: bpm=${noiseResult.bpm} quality=${noiseResult.quality} ` +
    `snrDb=${noiseResult.snrDb}`);

  check(
    'pure-noise input yields quality === invalid',
    noiseResult.quality === 'invalid',
    `quality=${noiseResult.quality} snrDb=${noiseResult.snrDb}`,
  );
  check(
    'invalid result has null classification',
    noiseResult.classification === null,
    `classification=${noiseResult.classification}`,
  );
  check(
    'invalid result has null hrvProxyMs',
    noiseResult.hrvProxyMs === null,
    `hrvProxyMs=${noiseResult.hrvProxyMs}`,
  );

  // --- Case 3: green-channel fallback path -------------------------------
  // Identical r/g/b channels make POS degenerate, so analyseHeart falls back
  // to the detrended green channel. Covers the fallback path and regresses
  // the detrend head-block fix (a zero block at the head would shift the bpm).
  const trueHz3 = 1.1; // 66 bpm
  const trueBpm3 = trueHz3 * 60;
  const rng3 = makeRng(0x3eed4321);
  const identSamples = synthIdenticalChannelSamples({
    pulseHz: trueHz3,
    durationSec: 20,
    nominalFps: 30,
    noise: 1.2,
    rng: rng3,
  });
  const identResult = analyseHeart({
    samples: identSamples,
    rate: effectiveRate(identSamples),
  });

  console.log('\nCase 3 (green-channel fallback, POS degenerate, pulse @ 1.1 Hz = 66 bpm):');
  console.log(`  detected: bpm=${identResult.bpm} quality=${identResult.quality} ` +
    `snrDb=${identResult.snrDb} classification=${identResult.classification}`);

  const bpmError3 = Math.abs(identResult.bpm - trueBpm3);
  check(
    'green-fallback recovers bpm within ~3 bpm of truth',
    bpmError3 <= 3,
    `error=${bpmError3.toFixed(1)} bpm (detected ${identResult.bpm}, truth ${trueBpm3})`,
  );
  check(
    'green-fallback signal is not flagged invalid',
    identResult.quality !== 'invalid',
    `quality=${identResult.quality}`,
  );

  console.log('');
  if (failures > 0) {
    console.error(`Resona rPPG DSP test: FAILED (${failures} assertion(s))`);
    process.exit(1);
  }
  console.log('Resona rPPG DSP test: PASS');
  process.exit(0);
}

main();
