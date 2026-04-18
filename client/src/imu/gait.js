// Gait analysis from accelerometer samples during a short walk.
//
// Participant puts phone in trouser/jacket pocket and walks ~10 steps.
// We detect steps via peak detection on the vertical (gravity-dominant)
// component of acceleration. Output: stride times, cadence, variance,
// rough symmetry.
//
// Screening only. Real gait analysis needs ground truth from wearables or
// pressure mats. This is a demo-grade approximation.

function mean(xs) {
  if (xs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
  return Math.sqrt(s / (xs.length - 1));
}

// Resample to uniform grid, same helper as tremor.js (kept local so
// modules don't depend on each other).
function resampleUniform(samples, valueFn, targetHz) {
  if (samples.length < 2) return { ts: [], vs: [] };
  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  const dtMs = 1000 / targetHz;
  const n = Math.max(1, Math.floor((tEnd - t0) / dtMs));
  const ts = new Float32Array(n);
  const vs = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dtMs;
    while (j + 1 < samples.length && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    const span = b.t - a.t || 1;
    const alpha = Math.max(0, Math.min(1, (t - a.t) / span));
    ts[i] = t;
    vs[i] = valueFn(a) * (1 - alpha) + valueFn(b) * alpha;
  }
  return { ts, vs };
}

// Low-pass via single-pole exponential smoothing.
function lowPass(xs, sampleRateHz, cutoffHz) {
  const dt = 1 / sampleRateHz;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  const out = new Float32Array(xs.length);
  let prev = xs[0] || 0;
  for (let i = 0; i < xs.length; i++) {
    prev = prev + alpha * (xs[i] - prev);
    out[i] = prev;
  }
  return out;
}

// Peak detection with a minimum spacing (refractory period in samples).
function findPeaks(xs, ts, minSpacingMs, minHeight) {
  const peaks = [];
  const n = xs.length;
  for (let i = 1; i < n - 1; i++) {
    if (xs[i] > xs[i - 1] && xs[i] >= xs[i + 1] && xs[i] >= minHeight) {
      if (peaks.length === 0 || ts[i] - ts[peaks[peaks.length - 1]] >= minSpacingMs) {
        peaks.push(i);
      } else if (xs[i] > xs[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
    }
  }
  return peaks.map((i) => ({ t: ts[i], v: xs[i] }));
}

export function analyseGait({ samples, rate }) {
  const targetHz = Math.max(50, Math.min(100, Math.round(rate || 60)));

  // Vertical axis varies with how the phone sits in a pocket. Use total
  // acceleration magnitude minus mean (gravity) as the step-energy signal.
  const { ts, vs } = resampleUniform(
    samples,
    (s) => Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az),
    targetHz,
  );

  const mu = mean(vs);
  const detrended = new Float32Array(vs.length);
  for (let i = 0; i < vs.length; i++) detrended[i] = Math.abs(vs[i] - mu);

  // Smooth to remove high-frequency jitter. Walking is typically 1.5-2.5 Hz.
  const smoothed = lowPass(detrended, targetHz, 5);

  // Minimum stride time: very fast walk is ~0.4s between steps.
  const minSpacingMs = 300;
  // Minimum peak height: relative to the signal's own standard deviation.
  const threshold = std(smoothed) * 0.8;

  const peaks = findPeaks(smoothed, ts, minSpacingMs, threshold);

  const strideTimesMs = [];
  for (let i = 1; i < peaks.length; i++) {
    strideTimesMs.push(peaks[i].t - peaks[i - 1].t);
  }

  const meanStrideMs = mean(strideTimesMs);
  const strideStdMs = std(strideTimesMs);
  const stridesCv = meanStrideMs > 0 ? strideStdMs / meanStrideMs : 0;
  const cadence = meanStrideMs > 0 ? 60000 / meanStrideMs : 0; // steps per minute

  // Crude left/right symmetry: split stride times into odd/even, compare means.
  const odd = strideTimesMs.filter((_, i) => i % 2 === 0);
  const even = strideTimesMs.filter((_, i) => i % 2 === 1);
  const mOdd = mean(odd);
  const mEven = mean(even);
  const symmetryIndex =
    mOdd > 0 && mEven > 0 ? 1 - Math.abs(mOdd - mEven) / Math.max(mOdd, mEven) : null;

  return {
    sampleRate: targetHz,
    stepsDetected: peaks.length,
    strideTimesMs,
    meanStrideMs,
    strideStdMs,
    stridesCv,
    cadence,
    symmetryIndex,
  };
}
