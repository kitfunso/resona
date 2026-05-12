// Feature extraction from a rPPG green-channel trace.
//
// Steps:
//   1. Resample irregular per-frame samples onto a uniform 30 Hz grid.
//   2. Detrend (subtract a 1.5s moving average) to kill ambient-light drift.
//   3. Forward FFT (Hann-windowed). Peak in [0.7, 4] Hz = mean HR (42-240 bpm).
//   4. Frequency-domain bandpass: zero bins outside band, inverse FFT.
//   5. Peak-detect the bandpassed signal for RR intervals → HRV (RMSSD/SDNN).
//
// HR is robust because it's a peak-pick in a narrow band. HRV is sensitive
// to noise and motion — flag it low confidence if framesUsed is small or
// signal SNR is low.

const HR_BAND_LO_HZ = 0.7;  // 42 bpm
const HR_BAND_HI_HZ = 4.0;  // 240 bpm
const RESAMPLE_HZ = 30;
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

// In-place complex Cooley–Tukey FFT (radix-2). Set `inverse` to run IFFT.
// Length must be power of 2.
function fft(re, im, inverse = false) {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be power of 2');

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
    const theta = (inverse ? TWO_PI : -TWO_PI) / size;
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
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

// Linear-interpolate (samples[i], timestamps[i]) onto a uniform grid at
// targetHz. Webcam frame deltas aren't perfectly regular, so this matters
// for the FFT.
function resampleUniform(samples, timestamps, targetHz) {
  if (samples.length < 2) return new Float32Array(0);
  const t0 = timestamps[0];
  const tEnd = timestamps[timestamps.length - 1];
  const dtMs = 1000 / targetHz;
  const n = Math.max(1, Math.floor((tEnd - t0) / dtMs));
  const out = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dtMs;
    while (j + 1 < timestamps.length && timestamps[j + 1] < t) j++;
    const a = timestamps[j];
    const b = timestamps[Math.min(j + 1, timestamps.length - 1)];
    const span = (b - a) || 1;
    const alpha = Math.max(0, Math.min(1, (t - a) / span));
    out[i] =
      samples[j] * (1 - alpha) +
      samples[Math.min(j + 1, samples.length - 1)] * alpha;
  }
  return out;
}

// Subtract a moving average of half-width `radius` samples. Approximate
// rectangular high-pass; cheap and robust against the slow drift of room
// lighting and camera AGC.
function detrendMovingAvg(signal, radius) {
  const n = signal.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  // Cumulative sum for O(n) moving average.
  const csum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) csum[i + 1] = csum[i] + signal[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);
    const avg = (csum[hi] - csum[lo]) / (hi - lo);
    out[i] = signal[i] - avg;
  }
  return out;
}

// Frequency-domain bandpass: zero out FFT bins outside [loHz, hiHz] (and
// their negative-frequency mirrors), then inverse FFT. Returns a real-valued
// signal of the same length as the input (first n samples).
function bandpass(signal, sampleRateHz, loHz, hiHz) {
  const nFft = nextPow2(signal.length);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  for (let i = 0; i < signal.length; i++) re[i] = signal[i];
  fft(re, im, false);
  const binHz = sampleRateHz / nFft;
  for (let i = 0; i < nFft; i++) {
    // For bin index i, the frequency is min(i, nFft - i) * binHz (because
    // bins above nFft/2 correspond to negative frequencies). We zero both
    // halves outside the band.
    const k = Math.min(i, nFft - i);
    const fHz = k * binHz;
    if (fHz < loHz || fHz > hiHz) {
      re[i] = 0;
      im[i] = 0;
    }
  }
  fft(re, im, true);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = re[i];
  return out;
}

function argmaxBin(mags, binHz, loHz, hiHz) {
  let maxVal = -Infinity;
  let maxIdx = -1;
  for (let i = 1; i < mags.length; i++) {
    const fHz = i * binHz;
    if (fHz < loHz || fHz > hiHz) continue;
    if (mags[i] > maxVal) {
      maxVal = mags[i];
      maxIdx = i;
    }
  }
  return { fHz: maxIdx < 0 ? null : maxIdx * binHz, power: maxVal, bin: maxIdx };
}

// Parabolic interpolation around the peak bin to get a sub-bin-resolution HR
// estimate. Without this, FFT bin width (sampleRate / nFft) caps how finely
// we can resolve HR — at 30 Hz and ~900 samples that's ~2 bpm bin width.
function parabolicInterpolate(mags, peakBin) {
  if (peakBin <= 0 || peakBin >= mags.length - 1) return peakBin;
  const a = mags[peakBin - 1];
  const b = mags[peakBin];
  const c = mags[peakBin + 1];
  const denom = a - 2 * b + c;
  if (Math.abs(denom) < 1e-12) return peakBin;
  return peakBin + 0.5 * (a - c) / denom;
}

function fftMagnitudeHann(signal) {
  const nFft = nextPow2(signal.length);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const nSrc = signal.length;
  for (let i = 0; i < nSrc; i++) {
    const w = 0.5 * (1 - Math.cos((TWO_PI * i) / (nSrc - 1)));
    re[i] = signal[i] * w;
  }
  fft(re, im, false);
  const half = nFft / 2;
  const mags = new Float32Array(half);
  for (let i = 0; i < half; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return { mags, nFft };
}

// Local-max peak detection on the bandpassed signal. A peak is a sample
// greater than its neighbours and above a fraction of the running max.
// Used to estimate RR intervals (peak-to-peak in milliseconds).
function detectPeaks(signal, sampleRateHz) {
  const n = signal.length;
  if (n < 3) return [];
  // Running absolute max as a noise floor.
  let absMax = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(signal[i]);
    if (v > absMax) absMax = v;
  }
  const threshold = absMax * 0.20; // amplitude must exceed 20% of peak swing
  const minSampleGap = Math.floor(sampleRateHz * 0.35); // refractory: 0.35s ≈ HR ≤ 170
  const peaks = [];
  let lastPeakIdx = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const v = signal[i];
    if (v <= threshold) continue;
    if (v <= signal[i - 1] || v <= signal[i + 1]) continue;
    if (i - lastPeakIdx < minSampleGap) {
      if (v > signal[lastPeakIdx]) {
        peaks[peaks.length - 1] = i;
        lastPeakIdx = i;
      }
      continue;
    }
    peaks.push(i);
    lastPeakIdx = i;
  }
  return peaks;
}

function rmssd(rrIntervalsMs) {
  const n = rrIntervalsMs.length;
  if (n < 2) return null;
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const d = rrIntervalsMs[i] - rrIntervalsMs[i - 1];
    sum += d * d;
  }
  return Math.sqrt(sum / (n - 1));
}

function sdnn(rrIntervalsMs) {
  const n = rrIntervalsMs.length;
  if (n < 2) return null;
  const mu = mean(rrIntervalsMs);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = rrIntervalsMs[i] - mu;
    s += d * d;
  }
  return Math.sqrt(s / (n - 1));
}

// Top-level feature extraction. samples/timestamps come from
// recorder.js#captureRppg.
export function extractHeartFeatures({ samples, timestamps, fps, framesUsed }) {
  if (!samples || samples.length < 90) {
    throw new Error('Not enough frames for rPPG analysis (need >= 90).');
  }

  // Resample to uniform grid.
  const uniform = resampleUniform(samples, timestamps, RESAMPLE_HZ);
  if (uniform.length < 90) {
    throw new Error('Resampled signal too short.');
  }

  // Detrend with a window around 1.5s wide.
  const detrend = detrendMovingAvg(uniform, Math.round(RESAMPLE_HZ * 0.75));

  // FFT for the HR peak.
  const { mags, nFft } = fftMagnitudeHann(detrend);
  const binHz = RESAMPLE_HZ / nFft;
  const peak = argmaxBin(mags, binHz, HR_BAND_LO_HZ, HR_BAND_HI_HZ);

  let hrBpm = null;
  if (peak.bin >= 0) {
    const fracBin = parabolicInterpolate(mags, peak.bin);
    hrBpm = fracBin * binHz * 60;
  }

  // SNR: peak magnitude squared vs mean of other in-band bins. Cheap proxy
  // for how clean the cardiac signal is.
  let inBandSum = 0;
  let inBandCount = 0;
  for (let i = 1; i < mags.length; i++) {
    const fHz = i * binHz;
    if (fHz < HR_BAND_LO_HZ || fHz > HR_BAND_HI_HZ) continue;
    inBandSum += mags[i] * mags[i];
    inBandCount++;
  }
  const inBandMeanPower = inBandCount > 0 ? inBandSum / inBandCount : 0;
  const peakPower = peak.power != null ? peak.power * peak.power : 0;
  const snr =
    inBandMeanPower > 0 && peakPower > 0 ? peakPower / inBandMeanPower : 0;

  // Bandpass + peak detect → RR intervals → HRV metrics.
  const filtered = bandpass(detrend, RESAMPLE_HZ, HR_BAND_LO_HZ, HR_BAND_HI_HZ);
  const peakIndices = detectPeaks(filtered, RESAMPLE_HZ);
  const rrIntervals = [];
  for (let i = 1; i < peakIndices.length; i++) {
    const dtMs = ((peakIndices[i] - peakIndices[i - 1]) / RESAMPLE_HZ) * 1000;
    // Reject obviously impossible intervals (HR < 30 or > 240 bpm).
    if (dtMs >= 250 && dtMs <= 2000) rrIntervals.push(dtMs);
  }
  const hrvRmssdMs = rmssd(rrIntervals);
  const sdnnMs = sdnn(rrIntervals);
  const beatCount = peakIndices.length;

  // Cross-check HR from RR intervals — if they disagree wildly, signal is
  // unreliable. Used as a quality flag rather than as the primary HR estimate.
  let hrFromRrBpm = null;
  if (rrIntervals.length >= 3) {
    hrFromRrBpm = 60000 / mean(rrIntervals);
  }

  return {
    hrBpm: hrBpm != null ? Math.round(hrBpm * 10) / 10 : null,
    hrFromRrBpm: hrFromRrBpm != null ? Math.round(hrFromRrBpm * 10) / 10 : null,
    hrvRmssdMs: hrvRmssdMs != null ? Math.round(hrvRmssdMs * 10) / 10 : null,
    sdnnMs: sdnnMs != null ? Math.round(sdnnMs * 10) / 10 : null,
    snr: Number.isFinite(snr) ? Math.round(snr * 10) / 10 : 0,
    beatCount,
    rrIntervalCount: rrIntervals.length,
    framesUsed: framesUsed ?? samples.length,
    sampleRateHz: RESAMPLE_HZ,
    captureFps: fps != null ? Math.round(fps * 10) / 10 : null,
    durationSec: Math.round((uniform.length / RESAMPLE_HZ) * 10) / 10,
  };
}
