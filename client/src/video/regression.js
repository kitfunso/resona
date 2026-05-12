// Turn raw rPPG features into a heart estimate + classification.
//
// rPPG on a phone front camera is a screening tool — error bars are wide
// (±5–10 bpm in good light, much worse with motion or dim light). We do NOT
// pretend to clinical-grade pulse oximetry. The classification below is
// deliberately conservative: an honest "looks normal" / "looks high" /
// "looks low" / "couldn't read it" rather than a diagnosis.

// American Heart Association resting HR norms for adults:
//   Normal:        60–100 bpm
//   Athlete:       40–60 bpm
//   Tachycardia:   > 100 bpm (at rest)
//   Bradycardia:   < 60 bpm (often fine if asymptomatic and fit)
// HRV (RMSSD) reference: typical adults sit in 20–80 ms at rest; <20 ms is
// low (chronic stress / poor recovery), >80 ms is high (parasympathetic
// dominance, often endurance-trained).

export const HR_BANDS = {
  bradycardia: { lo: 0,   hi: 60 },
  normal:      { lo: 60,  hi: 100 },
  tachycardia: { lo: 100, hi: 240 },
};

export function classifyHr(hrBpm) {
  if (hrBpm == null || !Number.isFinite(hrBpm)) return 'unknown';
  if (hrBpm < HR_BANDS.bradycardia.hi) return 'bradycardia';
  if (hrBpm < HR_BANDS.normal.hi) return 'normal';
  return 'tachycardia';
}

export function classifyHrv(hrvRmssdMs) {
  if (hrvRmssdMs == null || !Number.isFinite(hrvRmssdMs)) return 'unknown';
  if (hrvRmssdMs < 20) return 'low';
  if (hrvRmssdMs <= 80) return 'typical';
  return 'high';
}

// Quality gate: when does the signal look good enough to even show numbers?
// SNR < 1.5 = peak is barely above the in-band noise floor → unreliable.
// Cross-check between FFT-HR and RR-HR — they should agree to ~15 bpm; if
// not, something's wrong (camera motion, irregular rhythm, poor lighting).
// Bands: 'good' / 'fair' / 'poor'. 'poor' suppresses the AI report.
export function gradeQuality(features) {
  const reasons = [];
  if (features.framesUsed < 600) reasons.push('few_frames');
  if (features.snr < 1.5) reasons.push('low_snr');
  if (features.beatCount < 15) reasons.push('few_beats');
  if (features.hrBpm == null) reasons.push('no_peak');

  if (features.hrBpm != null && features.hrFromRrBpm != null) {
    const delta = Math.abs(features.hrBpm - features.hrFromRrBpm);
    if (delta > 20) reasons.push('hr_methods_disagree');
  }

  let grade = 'good';
  if (reasons.length === 1) grade = 'fair';
  if (reasons.length >= 2) grade = 'poor';
  if (reasons.includes('no_peak')) grade = 'poor';
  return { grade, reasons };
}

// Sanity-clamp the HR estimate. Resting HR outside [40, 200] on a phone
// camera at a hackathon is almost certainly artefact (e.g. picking up a 1Hz
// camera AGC oscillation as 60 bpm, or motion at the third harmonic). We
// return the value but tag the estimate as out-of-range so the UI can warn.
function clampHr(hrBpm) {
  if (hrBpm == null) return { value: null, outOfRange: false };
  const outOfRange = hrBpm < 40 || hrBpm > 200;
  return { value: hrBpm, outOfRange };
}

export function estimateHeart({ features, demographics = {} }) {
  const { value: hrClamped, outOfRange } = clampHr(features.hrBpm);
  const hrClass = classifyHr(hrClamped);
  const hrvClass = classifyHrv(features.hrvRmssdMs);
  const quality = gradeQuality(features);

  // Resting HR drifts slightly with age — older adults sit closer to the top
  // of "normal" on average. We don't gate the classification on age, but we
  // do surface an ageNote so the AI report can use it.
  const age = Number(demographics.ageYears) || null;
  let ageNote = null;
  if (age) {
    if (age < 25 && hrClamped != null && hrClamped < 55) ageNote = 'low_for_young_adult';
    if (age > 60 && hrClamped != null && hrClamped > 90) ageNote = 'high_for_older_adult';
  }

  return {
    hrBpm: hrClamped,
    hrBpmOutOfRange: outOfRange,
    hrvRmssdMs: features.hrvRmssdMs,
    sdnnMs: features.sdnnMs,
    snr: features.snr,
    beatCount: features.beatCount,
    rrIntervalCount: features.rrIntervalCount,
    framesUsed: features.framesUsed,
    durationSec: features.durationSec,
    captureFps: features.captureFps,
    sampleRateHz: features.sampleRateHz,
    hrClassification: hrClass,
    hrvClassification: hrvClass,
    quality,
    ageNote,
  };
}
