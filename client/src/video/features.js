// Heart-rate and heart-rate-variability extraction from per-frame RGB samples.
// Pipeline:
//   1. Resample timestamped RGB to a uniform 30 Hz grid.
//   2. Run POS on each ROI, average the resulting pulse signals.
//   3. Hann-window + FFT, peak in 0.7-4 Hz, parabolic interp -> hrBpm.
//   4. Frequency-domain bandpass + IFFT -> filtered trace.
//   5. Peak-detect with refractory window -> RR intervals -> RMSSD, SDNN.
//   6. Quality grade from SNR, frame count, beat count, agreement.

import { computePosSignal } from './pos.js';

const TWO_PI = 2 * Math.PI;
const TARGET_FPS = 30;
const HR_BAND_LO = 0.7; // 42 bpm
const HR_BAND_HI = 4.0; // 240 bpm

function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

// Linear-interpolate channel `x` (sampled at timestamps `t` in ms) onto a
// uniform `targetFps` grid spanning [t[0], t[last]].
function resample(t, x, targetFps) {
  const n = t.length;
  if (n < 2) return { values: new Float32Array(0), fps: targetFps };
  const t0 = t[0];
  const tEnd = t[n - 1];
  const totalSec = (tEnd - t0) / 1000;
  const m = Math.max(2, Math.floor(totalSec * targetFps));
  const out = new Float32Array(m);
  let j = 0;
  for (let i = 0; i < m; i++) {
    const targetMs = t0 + (i / targetFps) * 1000;
    while (j < n - 2 && t[j + 1] < targetMs) j++;
    const t1 = t[j];
    const t2 = t[j + 1];
    if (t2 === t1) { out[i] = x[j]; continue; }
    const frac = (targetMs - t1) / (t2 - t1);
    out[i] = x[j] + frac * (x[j + 1] - x[j]);
  }
  return { values: out, fps: targetFps };
}

// In-place Hann window.
function hann(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos(TWO_PI * i / (n - 1)));
    arr[i] *= w;
  }
}

// Iterative radix-2 Cooley-Tukey FFT on complex buffers re[], im[] of length n=2^k.
function fftInPlace(re, im) {
  const n = re.length;
  // Bit reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tr = re[i]; re[i] = re[j]; re[j] = tr;
      let ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const halfsize = size / 2;
    const tablestep = TWO_PI / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < halfsize; k++) {
        const angle = -k * tablestep;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const a = i + k;
        const b = a + halfsize;
        const tre = re[b] * cos - im[b] * sin;
        const tim = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
      }
    }
  }
}

function ifftInPlace(re, im) {
  // Conjugate, FFT, conjugate, divide by n.
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}

export function extractHeartFeatures({ samples, durationSec }) {
  const reasons = [];
  const { t, forehead, cheeks } = samples;

  // Resample each channel onto a uniform 30 Hz grid.
  const fR = resample(t, forehead.r, TARGET_FPS);
  const fG = resample(t, forehead.g, TARGET_FPS);
  const fB = resample(t, forehead.b, TARGET_FPS);
  const cR = resample(t, cheeks.r, TARGET_FPS);
  const cG = resample(t, cheeks.g, TARGET_FPS);
  const cB = resample(t, cheeks.b, TARGET_FPS);

  const framesUsed = fG.values.length;
  if (framesUsed < 600) reasons.push('few_frames');

  // POS per ROI.
  const sForehead = computePosSignal({ r: fR.values, g: fG.values, b: fB.values, fps: TARGET_FPS });
  const sCheeks = computePosSignal({ r: cR.values, g: cG.values, b: cB.values, fps: TARGET_FPS });

  // Average the two ROI pulse signals.
  const n = framesUsed;
  const pulse = new Float32Array(n);
  for (let i = 0; i < n; i++) pulse[i] = (sForehead[i] + sCheeks[i]) * 0.5;

  // FFT setup.
  const N = nextPow2(n);

  // --- Pass 1: Hann-windowed FFT for spectral HR estimation.
  // The Hann window reduces spectral leakage, giving a cleaner peak in the
  // frequency domain. Do NOT reuse these coefficients for the IFFT bandpass
  // below — the Hann weighting would taper the reconstructed signal to near
  // zero at both ends, causing the peak-detector to miss beats in the first
  // and last ~5 seconds of the window.
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < n; i++) re[i] = pulse[i];
  hann(re.subarray(0, n));
  fftInPlace(re, im);

  // Find peak bin in 0.7-4 Hz.
  const binHz = TARGET_FPS / N;
  const loBin = Math.max(1, Math.ceil(HR_BAND_LO / binHz));
  const hiBin = Math.min(Math.floor(N / 2) - 1, Math.floor(HR_BAND_HI / binHz));

  let peakBin = -1;
  let peakMag = -Infinity;
  let bandSum = 0;
  for (let k = loBin; k <= hiBin; k++) {
    const mag = re[k] * re[k] + im[k] * im[k];
    bandSum += mag;
    if (mag > peakMag) { peakMag = mag; peakBin = k; }
  }

  let hrBpm = NaN;
  let snr = 0;
  if (peakBin > 0 && peakMag > 0) {
    // Parabolic interpolation around the peak bin.
    const m0 = Math.sqrt(re[peakBin - 1] * re[peakBin - 1] + im[peakBin - 1] * im[peakBin - 1]);
    const m1 = Math.sqrt(peakMag);
    const m2 = Math.sqrt(re[peakBin + 1] * re[peakBin + 1] + im[peakBin + 1] * im[peakBin + 1]);
    const denom = (m0 - 2 * m1 + m2);
    const delta = denom !== 0 ? 0.5 * (m0 - m2) / denom : 0;
    const peakHz = (peakBin + delta) * binHz;
    hrBpm = peakHz * 60;
    const otherSum = bandSum - peakMag;
    const otherCount = (hiBin - loBin + 1) - 1;
    snr = otherSum > 0 ? peakMag / (otherSum / Math.max(1, otherCount)) : 0;
  } else {
    reasons.push('no_peak');
  }

  if (snr < 1.5 && !reasons.includes('no_peak')) reasons.push('low_snr');

  // --- Pass 2: Unwindowed FFT for frequency-domain bandpass + IFFT.
  // Using the unwindowed transform ensures full-amplitude reconstruction
  // across the entire signal length, so the peak-detector sees beats uniformly
  // from start to end rather than only in the centre of the window.
  const reU = new Float32Array(N);
  const imU = new Float32Array(N);
  for (let i = 0; i < n; i++) reU[i] = pulse[i];
  fftInPlace(reU, imU);

  // Frequency-domain bandpass for HRV peak detection. Zero everything outside
  // [HR_BAND_LO, HR_BAND_HI] in both positive and negative-frequency halves.
  const reBP = new Float32Array(N);
  const imBP = new Float32Array(N);
  for (let k = loBin; k <= hiBin; k++) {
    reBP[k] = reU[k]; imBP[k] = imU[k];
    const mirror = N - k;
    if (mirror < N) { reBP[mirror] = reU[mirror]; imBP[mirror] = imU[mirror]; }
  }
  ifftInPlace(reBP, imBP);

  // Peak detection on the real-valued filtered trace, restricted to [0, n).
  const trace = reBP.subarray(0, n);
  let absMax = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(trace[i]);
    if (v > absMax) absMax = v;
  }
  const threshold = absMax * 0.2;
  const refractoryFrames = Math.round(TARGET_FPS * 0.35);
  const peaks = [];
  for (let i = 1; i < n - 1; i++) {
    if (trace[i] > threshold && trace[i] > trace[i - 1] && trace[i] >= trace[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= refractoryFrames) {
        peaks.push(i);
      }
    }
  }

  // RR intervals in ms.
  const rr = [];
  for (let i = 1; i < peaks.length; i++) {
    const ms = (peaks[i] - peaks[i - 1]) * (1000 / TARGET_FPS);
    if (ms >= 250 && ms <= 2000) rr.push(ms);
  }
  if (rr.length < 20) reasons.push('few_beats');

  let hrvRmssdMs = null;
  let sdnnMs = null;
  if (rr.length >= 2) {
    let diffSqSum = 0;
    for (let i = 1; i < rr.length; i++) {
      const d = rr[i] - rr[i - 1];
      diffSqSum += d * d;
    }
    hrvRmssdMs = Math.sqrt(diffSqSum / (rr.length - 1));
    let mean = 0; for (const x of rr) mean += x; mean /= rr.length;
    let varSum = 0; for (const x of rr) varSum += (x - mean) * (x - mean);
    sdnnMs = Math.sqrt(varSum / rr.length);
  }

  // Method-agreement check.
  let hrFromRr = null;
  if (rr.length >= 3) {
    let mean = 0; for (const x of rr) mean += x; mean /= rr.length;
    hrFromRr = 60000 / mean;
    if (Number.isFinite(hrBpm) && Math.abs(hrBpm - hrFromRr) > 15) reasons.push('hr_methods_disagree');
  }

  // Hard disqualifiers: any single one means we cannot trust a number, so we
  // refuse to show one (grade 'poor' -> the UI short-circuits to coaching).
  //  - no_peak: no spectral pulse peak at all.
  //  - hr_methods_disagree: the spectral HR and the beat-interval HR differ by
  //    >15 bpm, i.e. two independent estimators of the same quantity diverge.
  //    By construction we do not have a measurement, so a number here is a
  //    confident-wrong risk (e.g. pure noise -> a spurious ~142 bpm). For a
  //    screening tool, false-'poor' (retake) beats showing an invented vital.
  const HARD_REASONS = ['no_peak', 'hr_methods_disagree'];
  let grade;
  if (reasons.some((r) => HARD_REASONS.includes(r)) || reasons.length >= 2) grade = 'poor';
  else if (reasons.length === 1) grade = 'fair';
  else grade = 'good';

  return {
    hrBpm: Number.isFinite(hrBpm) ? hrBpm : null,
    hrvRmssdMs,
    sdnnMs,
    snr,
    beatCount: rr.length + (rr.length > 0 ? 1 : 0),
    durationSec,
    framesUsed,
    reasons,
    grade,
  };
}
