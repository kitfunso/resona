// Feature extraction from a forced-exhalation PCM buffer.
// Based on SpiroSmart (Goel et al., UbiComp 2012):
//   - Envelope via rectified + low-pass (approximates |Hilbert transform|)
//   - Peak envelope amplitude
//   - Envelope decay time constant (tau) via exponential fit on the decay tail
//   - RMS energy
//   - First formant frequency via FFT peak-picking on the loud segment

const TWO_PI = 2 * Math.PI;

function rectify(pcm) {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.abs(pcm[i]);
  return out;
}

// Single-pole low-pass. alpha = dt / (RC + dt), dt = 1/sampleRate.
function lowPass(samples, sampleRate, cutoffHz = 20) {
  const rc = 1 / (TWO_PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

export function computeEnvelope(pcm, sampleRate) {
  return lowPass(rectify(pcm), sampleRate, 20);
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function argmax(samples) {
  let maxVal = -Infinity;
  let maxIdx = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] > maxVal) {
      maxVal = samples[i];
      maxIdx = i;
    }
  }
  return { value: maxVal, index: maxIdx };
}

// Fit an exponential decay y = A * exp(-t / tau) to the envelope AFTER its peak.
// Linear regression on log(y) vs t, restricted to y > peakFraction * peak.
function exponentialDecayTau(envelope, sampleRate, peakIdx, peakFraction = 0.1) {
  const peakVal = envelope[peakIdx];
  if (peakVal <= 0) return null;
  const threshold = peakVal * peakFraction;

  const ts = [];
  const ys = [];
  for (let i = peakIdx; i < envelope.length; i++) {
    const v = envelope[i];
    if (v <= threshold) break;
    ts.push((i - peakIdx) / sampleRate);
    ys.push(Math.log(Math.max(v, 1e-12)));
  }
  if (ts.length < 20) return null; // too few points

  const n = ts.length;
  const meanT = ts.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (ts[i] - meanT) * (ys[i] - meanY);
    den += (ts[i] - meanT) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  if (slope >= 0) return null; // not decaying
  return -1 / slope; // tau in seconds
}

// Cooley–Tukey iterative FFT (radix-2). Input length must be power of 2.
// Real input only; output is magnitudes (length = n/2).
function fftMagnitude(realInput) {
  const n = realInput.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be power of 2');

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = realInput[i];

  // Bit reversal
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

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Hann-windowed FFT peak pick in a voice range.
// Returns Hz of the dominant spectral component, skipping DC (<60 Hz).
function firstFormantHz(pcm, sampleRate, rangeHz = [60, 4000]) {
  const targetLen = Math.min(pcm.length, 16384);
  const start = Math.max(0, Math.floor((pcm.length - targetLen) / 2));
  const slice = pcm.subarray(start, start + targetLen);

  const nFft = nextPow2(targetLen);
  const windowed = new Float32Array(nFft);
  for (let i = 0; i < targetLen; i++) {
    const w = 0.5 * (1 - Math.cos((TWO_PI * i) / (targetLen - 1))); // Hann
    windowed[i] = slice[i] * w;
  }
  const mags = fftMagnitude(windowed);
  const binHz = sampleRate / nFft;
  const lowBin = Math.floor(rangeHz[0] / binHz);
  const highBin = Math.min(mags.length - 1, Math.floor(rangeHz[1] / binHz));
  let peakIdx = lowBin;
  let peakVal = -Infinity;
  for (let i = lowBin; i <= highBin; i++) {
    if (mags[i] > peakVal) {
      peakVal = mags[i];
      peakIdx = i;
    }
  }
  return peakIdx * binHz;
}

// Returns seconds the envelope stays above `threshold * peakEnv`.
// AGC-proof: shape-based, not amplitude-based.
function activeDurationAboveFraction(envelope, sampleRate, peakVal, fraction) {
  const threshold = peakVal * fraction;
  let samples = 0;
  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] >= threshold) samples++;
  }
  return samples / sampleRate;
}

// Top-level feature extraction.
export function extractFeatures(pcm, sampleRate) {
  if (pcm.length < sampleRate * 0.5) {
    throw new Error('recording too short (<0.5s)');
  }

  const envelope = computeEnvelope(pcm, sampleRate);
  const peak = argmax(envelope);
  const peakEnv = peak.value;
  const peakTimeSec = peak.index / sampleRate;
  const rmsEnergy = rms(pcm);
  const tauSec = exponentialDecayTau(envelope, sampleRate, peak.index);
  const formantHz = firstFormantHz(pcm, sampleRate);
  const durationSec = pcm.length / sampleRate;

  // AGC-proof shape features: time envelope spends above fractions of its peak.
  // Strong forced exhalation starts high and tapers (real physiology), so the
  // 10% band captures the full tapered tail. The 50/20 bands are retained as
  // secondary signals and for debug visibility.
  const activeSec50 = activeDurationAboveFraction(envelope, sampleRate, peakEnv, 0.5);
  const activeSec20 = activeDurationAboveFraction(envelope, sampleRate, peakEnv, 0.2);
  const activeSec10 = activeDurationAboveFraction(envelope, sampleRate, peakEnv, 0.1);
  const activeSec05 = activeDurationAboveFraction(envelope, sampleRate, peakEnv, 0.05);

  return {
    peakEnv,
    peakTimeSec,
    rmsEnergy,
    tauSec, // may be null if no clean decay
    formantHz,
    durationSec,
    activeSec50,
    activeSec20,
    activeSec10,
    activeSec05,
    sampleRate,
  };
}
