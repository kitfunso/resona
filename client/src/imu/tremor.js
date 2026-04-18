// Tremor analysis from accelerometer samples.
//
// Stillness test: user holds phone at arm's length for ~10s. We compute
// acceleration magnitude minus gravity, detrend, FFT, and report power in
// four bands:
//   0.5-4 Hz  — not tremor (voluntary movement / postural drift)
//   4-6 Hz    — Parkinsonian tremor (rest tremor)
//   6-12 Hz   — essential tremor / kinetic tremor
//   12-20 Hz  — physiological tremor (normal muscle activity)
//
// Screening only. The output IS NOT diagnostic.

const TWO_PI = 2 * Math.PI;

function mean(xs) {
  if (xs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Radix-2 Cooley-Tukey FFT on real input, returns magnitudes (n/2 bins).
function fftMagnitude(realInput) {
  const n = realInput.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be power of 2');

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = realInput[i];

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const theta = -TWO_PI / size;
    const wRe = Math.cos(theta);
    const wIm = Math.sin(theta);
    for (let block = 0; block < n; block += size) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const i0 = block + k;
        const i1 = i0 + half;
        const tRe = curRe * re[i1] - curIm * im[i1];
        const tIm = curRe * im[i1] + curIm * re[i1];
        re[i1] = re[i0] - tRe;
        im[i1] = im[i0] - tIm;
        re[i0] = re[i0] + tRe;
        im[i0] = im[i0] + tIm;
        const newCurRe = curRe * wRe - curIm * wIm;
        const newCurIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
        curIm = newCurIm;
      }
    }
  }

  const mags = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return mags;
}

// Resample an irregular time series to a regular grid at `targetHz`.
// DeviceMotion samples aren't perfectly uniform; we linearly interpolate.
function resampleUniform(samples, valueFn, targetHz) {
  if (samples.length < 2) return new Float32Array(0);
  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  const dtMs = 1000 / targetHz;
  const n = Math.max(1, Math.floor((tEnd - t0) / dtMs));
  const out = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dtMs;
    while (j + 1 < samples.length && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    const span = b.t - a.t || 1;
    const alpha = Math.max(0, Math.min(1, (t - a.t) / span));
    out[i] = valueFn(a) * (1 - alpha) + valueFn(b) * alpha;
  }
  return out;
}

// Bandpass power: sum of |FFT[k]|^2 over bins whose centre frequency
// lies in [loHz, hiHz]. Returns absolute power (unnormalised).
function bandPower(mags, binHz, loHz, hiHz) {
  let p = 0;
  for (let i = 0; i < mags.length; i++) {
    const fHz = i * binHz;
    if (fHz >= loHz && fHz <= hiHz) p += mags[i] * mags[i];
  }
  return p;
}

function argmaxBin(mags, binHz, loHz, hiHz) {
  let maxVal = -Infinity;
  let maxIdx = -1;
  for (let i = 0; i < mags.length; i++) {
    const fHz = i * binHz;
    if (fHz < loHz || fHz > hiHz) continue;
    if (mags[i] > maxVal) {
      maxVal = mags[i];
      maxIdx = i;
    }
  }
  return { fHz: maxIdx < 0 ? null : maxIdx * binHz, power: maxVal };
}

// Main entry — takes motion.captureMotion() output, returns classification.
export function analyseTremor({ samples, rate }) {
  const targetHz = Math.max(50, Math.min(100, Math.round(rate || 60)));

  // Acceleration magnitude removes orientation dependence (vs. single-axis).
  const magnitude = resampleUniform(
    samples,
    (s) => Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az),
    targetHz,
  );

  // Detrend: subtract mean (gravity ~9.81 m/s^2 contribution).
  const mu = mean(magnitude);
  const detrended = new Float32Array(magnitude.length);
  for (let i = 0; i < magnitude.length; i++) detrended[i] = magnitude[i] - mu;

  // Window (Hann) then FFT.
  const nFft = nextPow2(detrended.length);
  const windowed = new Float32Array(nFft);
  const nSrc = detrended.length;
  for (let i = 0; i < nSrc; i++) {
    const w = 0.5 * (1 - Math.cos((TWO_PI * i) / (nSrc - 1)));
    windowed[i] = detrended[i] * w;
  }
  const mags = fftMagnitude(windowed);
  const binHz = targetHz / nFft;

  // Non-overlapping bands with a small guard around clinical boundaries so a
  // healthy user whose arm drift lands at exactly 6 Hz doesn't accidentally
  // get flagged "Parkinsonian".
  const bands = {
    voluntary_0p5_3:    bandPower(mags, binHz, 0.5, 3),
    parkinsonian_3_5p5: bandPower(mags, binHz, 3, 5.5),
    essential_5p5_11:   bandPower(mags, binHz, 5.5, 11),
    physiological_11_20: bandPower(mags, binHz, 11, 20),
  };

  const tremorTotal =
    bands.parkinsonian_3_5p5 + bands.essential_5p5_11 + bands.physiological_11_20;
  const dominant = argmaxBin(mags, binHz, 3, 20);

  // Screening rule of thumb, NOT clinical:
  //   - Most healthy adults holding a phone for 10s have no dominant tremor
  //     signature. Default to "physiological" unless a suspect band clearly
  //     dominates the other two by at least 2x (Parkinsonian) or 1.6x
  //     (essential-like).
  //   - If voluntary low-frequency drift (< 3 Hz) outpowers all three tremor
  //     bands, the person was swaying their arm, not tremoring. Call it
  //     physiological too.
  let classification = 'physiological';
  let confidence = 0.5;
  const p = bands.parkinsonian_3_5p5;
  const e = bands.essential_5p5_11;
  const ph = bands.physiological_11_20;
  const v = bands.voluntary_0p5_3;

  if (v > tremorTotal * 1.5 || tremorTotal === 0) {
    classification = 'physiological';
    confidence = 0.85;
  } else if (p > 2 * Math.max(e, ph) && p > v) {
    classification = 'parkinsonian_like';
    confidence = p / tremorTotal;
  } else if (e > 1.6 * p && e > 1.2 * ph) {
    classification = 'essential_like';
    confidence = e / tremorTotal;
  } else {
    classification = 'physiological';
    confidence = ph / Math.max(1e-9, tremorTotal);
  }

  return {
    sampleRate: targetHz,
    bands,
    dominantFrequencyHz: dominant.fHz,
    classification, // physiological | essential_like | parkinsonian_like
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}
