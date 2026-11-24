import { hankinsonPredicted } from '../../../shared/reference-equations.js';

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

const NORMAL_SUSTAIN_SEC = 4.5;
const SEC_PER_SCORE_UNIT = 2.0;

function effortScore({ activeSec05 }) {
  return (activeSec05 - NORMAL_SUSTAIN_SEC) / SEC_PER_SCORE_UNIT;
}

function scoreToFraction(score) {
  return clamp(1.0 + 0.30 * score, 0.40, 1.30);
}

function perMetricBias(features) {
  const peakTimeSec = Number.isFinite(features.peakTimeSec) ? features.peakTimeSec : 0.4;
  const peakTimingZ = clamp((0.475 - peakTimeSec) / 0.325, -1, 1);

  const sec05 = Number.isFinite(features.activeSec05) ? features.activeSec05 : 4;
  const sec20 = Number.isFinite(features.activeSec20) ? features.activeSec20 : 3;
  const tailRatio = sec05 > 0 ? (sec05 - sec20) / sec05 : 0.3;
  const tailZ = clamp((tailRatio - 0.3) / 0.2, -1, 1);

  return {
    fev1: 0.04 * peakTimingZ,
    pef:  0.06 * peakTimingZ,
    fvc:  0.05 * tailZ,
  };
}

function sanityCheck({ fev1, fvc, pef }) {
  if (!Number.isFinite(fev1) || !Number.isFinite(fvc) || !Number.isFinite(pef)) {
    return { ok: false, reason: 'non-finite value' };
  }
  if (fev1 < 0.5 || fev1 > 8) return { ok: false, reason: `fev1 ${fev1.toFixed(2)} outside [0.5, 8]` };
  if (fvc < fev1) return { ok: false, reason: `fvc ${fvc.toFixed(2)} < fev1 ${fev1.toFixed(2)}` };
  if (pef < 1 || pef > 20) return { ok: false, reason: `pef ${pef.toFixed(2)} outside [1, 20]` };
  const ratio = fev1 / fvc;
  if (ratio < 0.5 || ratio > 1.0) return { ok: false, reason: `fev1/fvc ratio ${ratio.toFixed(2)} outside [0.5, 1.0]` };
  return { ok: true };
}

export function estimateSpirometry({ features, demographics }) {
  const predicted = hankinsonPredicted(demographics);

  const score = effortScore(features);
  const fraction = scoreToFraction(score);

  const bias = perMetricBias(features);
  const fev1Frac = clamp(fraction * (1 + bias.fev1), 0.40, 1.35);
  const fvcFrac  = clamp(fraction * (1 + bias.fvc),  0.40, 1.35);
  const pefFrac  = clamp(fraction * (1 + bias.pef),  0.40, 1.35);

  let fev1 = predicted.fev1 * fev1Frac;
  let fvc  = predicted.fvc  * fvcFrac;
  let pef  = predicted.pef  * pefFrac;

  if (fvc < fev1) fvc = fev1 * 1.05;

  const sanity = sanityCheck({ fev1, fvc, pef });
  let sanityFallback = false;
  if (!sanity.ok) {
    fev1 = predicted.fev1;
    fvc  = predicted.fvc;
    pef  = predicted.pef;
    sanityFallback = true;
  }

  return {
    fev1,
    fvc,
    pef,
    fev1FvcRatio: fev1 / fvc,
    predicted: {
      fev1: predicted.fev1,
      fvc: predicted.fvc,
      pef: predicted.pef,
    },
    percentPredicted: {
      fev1: (fev1 / predicted.fev1) * 100,
      fvc:  (fvc  / predicted.fvc)  * 100,
      pef:  (pef  / predicted.pef)  * 100,
    },
    effortScore: score,
    sanity,
    sanityFallback,
    referenceStatus: predicted.status,
    referenceNote: predicted.referenceNote,
  };
}
