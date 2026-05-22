// rPPG heart-rate DSP for Resona Module 3 (Heart). Pure functions, no browser
// APIs, so server/test-rppg.js can import this directly under node.
//
// Pipeline (see PLAN.md "The rPPG signal pipeline"):
//   1. resample R/G/B onto a uniform grid at the median camera fps
//   2. detrend each channel (subtract a moving mean)
//   3. POS demixing (Wang et al. 2017, Plane-Orthogonal-to-Skin): temporally
//      normalise RGB, project onto two orthogonal chrominance signals, combine
//      to a 1-D pulse waveform; green-channel fallback if POS is degenerate
//   4. bandpass 0.7-4.0 Hz (Hann window + radix-2 FFT)
//   5. dominant in-band frequency -> bpm = freq * 60
//   6. SNR (peak-band power / total in-band power) -> quality flag + sanity gate
//   7. HRV proxy: SDNN-like spread of inter-beat intervals (null if invalid)
//
// House style: this module owns local copies of resampleUniform, lowPass,
// fftMagnitude, nextPow2, the Hann window and bandPower. Resona modules do not
// import DSP from each other; per-module duplication is deliberate.
//
// Frequency-resolution honesty (refinement R2): the true resolution is 1/T,
// where T is the ~20 s capture window, so ~0.05 Hz which is about 3 bpm.
// nextPow2 zero-padding below only interpolates the spectrum; it does NOT add
// real resolution. Nothing here implies sub-3-bpm precision.

const TWO_PI = 2 * Math.PI;

// rPPG passband: 0.7-4.0 Hz is 42-240 bpm.
const BAND_LO_HZ = 0.7;
const BAND_HI_HZ = 4.0;

// Hard sanity gate: a plausible human resting/active range.
const BPM_MIN = 40;
const BPM_MAX = 200;

// SNR thresholds in dB. SNR here is the de Haan & Jeanne (2013) form: power in
// a narrow window around the pulse peak vs power in the rest of the in-band
// spectrum (the noise floor). A clean pulse sits well above 0 dB; white noise
// sits below it. These are screening thresholds, not clinical.
const SNR_GOOD_DB = 6.0;
const SNR_WEAK_DB = 0.0;

// Half-width of the peak window (Hz). Kept narrow so a flat (noise) spectrum
// cannot accumulate a large share of band power here by window width alone.
const PEAK_HALF_HZ = 0.12;

// --- copied helpers -------------------------------------------------------

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

// Resample an irregular time series to a regular grid at `targetHz`. Camera
// fps jitters, so we linearly interpolate (copied from imu/tremor.js).
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

// Single-pole low-pass. alpha = dt / (RC + dt) (copied from audio/features.js).
function lowPass(samples, sampleRate, cutoffHz) {
  const rc = 1 / (TWO_PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  let prev = samples.length > 0 ? samples[0] : 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

// Radix-2 Cooley-Tukey FFT on real input, returns magnitudes (n/2 bins).
// Copied from audio/features.js / imu/tremor.js.
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

// Bandpass power: sum of |FFT[k]|^2 over bins in [loHz, hiHz] (copied from
// imu/tremor.js).
function bandPower(mags, binHz, loHz, hiHz) {
  let p = 0;
  for (let i = 0; i < mags.length; i++) {
    const fHz = i * binHz;
    if (fHz >= loHz && fHz <= hiHz) p += mags[i] * mags[i];
  }
  return p;
}

// --- rPPG-specific stages -------------------------------------------------

// Detrend: subtract a slow moving mean so the slow lighting / motion drift is
// removed while the pulse band survives. Window ~ 1 s of samples.
function detrend(channel, fps) {
  const n = channel.length;
  const out = new Float32Array(n);
  const win = Math.max(3, Math.round(fps));
  const half = Math.floor(win / 2);
  // Prefix sums give every index a centred window mean in O(1), so the
  // detrended output is written exactly once at every index, head included.
  const prefix = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + channel[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    const localMean = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    out[i] = channel[i] - localMean;
  }
  return out;
}

function std(xs) {
  if (xs.length === 0) return 0;
  const mu = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - mu;
    s += d * d;
  }
  return Math.sqrt(s / xs.length);
}

// POS demixing (Wang et al. 2017, "Algorithmic Principles of Remote PPG",
// Plane-Orthogonal-to-Skin). Global-window form: temporally normalise each
// RGB channel by its own mean, build the two POS-orthogonal chrominance
// projections, then combine them with the std-ratio alpha tuning. Returns a
// 1-D pulse waveform, or null if the input variance is degenerate.
function posPulse(rRaw, gRaw, bRaw) {
  const n = rRaw.length;
  if (n < 8) return null;

  const meanR = mean(rRaw);
  const meanG = mean(gRaw);
  const meanB = mean(bRaw);
  if (meanR <= 0 || meanG <= 0 || meanB <= 0) return null;

  // Temporal normalisation: divide each channel by its own temporal mean.
  const rn = new Float32Array(n);
  const gn = new Float32Array(n);
  const bn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rn[i] = rRaw[i] / meanR;
    gn[i] = gRaw[i] / meanG;
    bn[i] = bRaw[i] / meanB;
  }

  // Two POS-orthogonal chrominance signals:
  //   s1 = Gn - Bn
  //   s2 = Gn + Bn - 2*Rn
  const s1 = new Float32Array(n);
  const s2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s1[i] = gn[i] - bn[i];
    s2[i] = gn[i] + bn[i] - 2 * rn[i];
  }

  const std1 = std(s1);
  const std2 = std(s2);
  if (std1 === 0 && std2 === 0) return null;

  // alpha tuning: scale s2 by std(s1)/std(s2) so the two projections are
  // balanced, then combine. h = s1 + alpha * s2.
  const alpha = std2 > 0 ? std1 / std2 : 0;
  const pulse = new Float32Array(n);
  for (let i = 0; i < n; i++) pulse[i] = s1[i] + alpha * s2[i];

  return std(pulse) > 0 ? pulse : null;
}

// Hann-windowed FFT of a waveform. Returns { mags, binHz }.
function spectrum(waveform, fps) {
  const nSrc = waveform.length;
  const nFft = nextPow2(nSrc);
  const windowed = new Float32Array(nFft);
  for (let i = 0; i < nSrc; i++) {
    const w = 0.5 * (1 - Math.cos((TWO_PI * i) / (nSrc - 1)));
    windowed[i] = waveform[i] * w;
  }
  const mags = fftMagnitude(windowed);
  // Zero-padding to nFft only interpolates; binHz is reported off nFft for
  // peak-picking convenience, but real resolution stays 1/T (refinement R2).
  return { mags, binHz: fps / nFft };
}

// Dominant bin and its power within [loHz, hiHz].
function dominantInBand(mags, binHz, loHz, hiHz) {
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
  return { fHz: maxIdx < 0 ? null : maxIdx * binHz, idx: maxIdx, power: maxVal };
}

// HRV proxy: filter the pulse waveform to the band, find beat peaks, and
// return the SDNN-like standard deviation of inter-beat intervals in ms.
// Low-confidence screening proxy only. Returns null if too few beats.
function hrvProxyMs(pulse, fps, bpm) {
  // Smooth to roughly the pulse band so we count beats, not noise spikes.
  const smoothed = lowPass(pulse, fps, BAND_HI_HZ);
  const minGapSamples = Math.max(1, Math.round((fps * 60) / (BPM_MAX)));
  const peaks = [];
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1] && smoothed[i] > 0) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minGapSamples) {
        peaks.push(i);
      }
    }
  }
  if (peaks.length < 4) return null;
  const intervalsMs = [];
  for (let i = 1; i < peaks.length; i++) {
    intervalsMs.push(((peaks[i] - peaks[i - 1]) / fps) * 1000);
  }
  // Drop intervals wildly off the detected rate (missed/spurious peaks).
  const expectedMs = 60000 / bpm;
  const kept = intervalsMs.filter((d) => d > expectedMs * 0.5 && d < expectedMs * 1.8);
  if (kept.length < 3) return null;
  return std(kept);
}

function classifyBpm(bpm) {
  if (bpm < 60) return 'low';
  if (bpm > 100) return 'elevated';
  return 'normal';
}

// --- main entry -----------------------------------------------------------

// Analyse a captureRPPG() result into a frozen heart feature object.
// Input: { samples: [{r,g,b,t}], rate }. Output shape per PLAN.md.
export function analyseHeart({ samples, rate }) {
  if (!Array.isArray(samples) || samples.length < 60) {
    throw new Error('rPPG analysis needs at least 60 frames');
  }

  // Resample R/G/B onto a uniform grid at the median camera fps.
  const fps = Math.max(10, Math.min(60, Math.round(rate || 30)));
  const r = resampleUniform(samples, (s) => s.r, fps);
  const g = resampleUniform(samples, (s) => s.g, fps);
  const b = resampleUniform(samples, (s) => s.b, fps);

  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  const durationSec = (tEnd - t0) / 1000;

  // Detrend the green channel for the green-fallback pulse path. POS consumes
  // the raw r/g/b channels (it does its own temporal normalisation).
  const gd = detrend(g, fps);

  // POS demixing with a green-channel fallback if POS is degenerate.
  let pulse = posPulse(r, g, b);
  if (!pulse || std(pulse) < 1e-9) {
    pulse = gd;
  }

  // Bandpass: low-pass to the upper edge, then the Hann+FFT spectrum carries
  // the lower edge via the in-band peak search.
  const banded = lowPass(pulse, fps, BAND_HI_HZ);
  const { mags, binHz } = spectrum(banded, fps);

  const dom = dominantInBand(mags, binHz, BAND_LO_HZ, BAND_HI_HZ);
  const totalBandPow = bandPower(mags, binHz, BAND_LO_HZ, BAND_HI_HZ);

  // SNR (de Haan & Jeanne 2013): power in a narrow window around the pulse
  // peak vs power in the rest of the in-band spectrum (the noise floor).
  const peakLo = dom.fHz != null ? dom.fHz - PEAK_HALF_HZ : 0;
  const peakHi = dom.fHz != null ? dom.fHz + PEAK_HALF_HZ : 0;
  const peakBandPow = bandPower(mags, binHz, peakLo, peakHi);
  const noiseFloorPow = Math.max(1e-9, totalBandPow - peakBandPow);
  const snrDb =
    peakBandPow > 0 ? 10 * Math.log10(peakBandPow / noiseFloorPow) : -99;

  const dominantHz = dom.fHz;
  // bpm rounded to whole beats: the true ~0.05 Hz (~3 bpm) resolution does not
  // justify any decimal precision (refinement R2).
  const bpm = dominantHz != null ? Math.round(dominantHz * 60) : 0;

  // Quality + hard sanity gate.
  let quality;
  if (dominantHz == null || bpm < BPM_MIN || bpm > BPM_MAX || snrDb < SNR_WEAK_DB) {
    quality = 'invalid';
  } else if (snrDb >= SNR_GOOD_DB) {
    quality = 'good';
  } else {
    quality = 'weak';
  }

  const hrv = quality === 'invalid' ? null : hrvProxyMs(banded, fps, bpm);

  return Object.freeze({
    bpm,
    quality,
    snrDb: Number.isFinite(snrDb) ? Math.round(snrDb * 10) / 10 : -99,
    dominantHz: dominantHz != null ? Math.round(dominantHz * 1000) / 1000 : null,
    hrvProxyMs: hrv != null ? Math.round(hrv * 10) / 10 : null,
    framesUsed: samples.length,
    effectiveFps: Math.round((rate || fps) * 10) / 10,
    durationSec: Math.round(durationSec * 10) / 10,
    classification: quality === 'invalid' ? null : classifyBpm(bpm),
  });
}
