// Demo-grade estimator from acoustic features to FEV1 / FVC / PEF.
//
// Demo-grade estimator, not clinical-grade. Calibrated to produce
// physiologically plausible values for Sunday demo.
//
// Strategy per brief: compute the user's Hankinson-predicted values, then
// map extracted features to a fraction of predicted such that:
//   weak effort   → 40–70%
//   typical       → 85–115%
//   strong effort → 110–130%
//
// Fraction driver is a tanh-squashed blend of peak envelope, RMS energy,
// and decay tau. Those three capture "how hard you blew" + "how long you
// sustained it" without inventing paper coefficients.

import { hankinsonPredicted } from '../../../shared/reference-equations.js';

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Combine features into a single "effort score".
//
// DURATION-ONLY SCORING. Calibrated against 11 blow attempts on iOS Safari
// which showed peak/rms varying by 3x between attempts of the same stated
// effort level, depending on phone-to-mouth distance. `activeSec20` is a
// within-blow ratio (time envelope stayed above 20% of its OWN peak), so it
// is invariant to distance, gain, and ambient noise floor.
//
// Mapping: each second of sustained exhalation = 0.5 score units = 15% predicted.
//   activeSec05 < 2s  → score < -1.0  → ~55-70% predicted  → weak
//   activeSec05 ~3s   → score ≈ -0.75 → ~80% predicted     → low-normal
//   activeSec05 ~4.5s → score = 0     → 100% predicted     → normal
//   activeSec05 ~5.5s → score ≈ +0.5  → ~115% predicted    → strong
//   activeSec05 ≥ 6s  → score ≥ +0.75 → ~120-130%         → max
//
// Why 5% not 10%/20% peak threshold? Turbulent-flow noise scales with the
// SQUARE of airflow rate. As the lungs empty, flow drops linearly but
// the mic envelope drops quadratically. So a user genuinely exhaling for
// 5s produces envelope that crosses 10% of peak at ~2-3s even though air
// is still flowing. A 5% threshold captures the full tapered exhalation
// while staying above typical mic noise floor.
//
// Why not amplitude? User's attempts 6 and 11 (both "max effort"):
//   attempt 6:  peakEnv=2.06, rmsEnergy=0.89
//   attempt 11: peakEnv=0.70, rmsEnergy=0.35
// Same user, same intent, 3x difference in amplitude. Phone held closer in 6.
const NORMAL_SUSTAIN_SEC = 4.5; // score = 0 at this activeSec05 duration
const SEC_PER_SCORE_UNIT = 2.0; // each unit of score = 2s of sustain

function effortScore({ activeSec05 }) {
  return (activeSec05 - NORMAL_SUSTAIN_SEC) / SEC_PER_SCORE_UNIT;
}

// Linear map of score to percent-predicted fraction.
// Chosen so score=-1 → 0.65 (weak target), score=0 → 1.00, score=+1 → 1.30.
function scoreToFraction(score) {
  return clamp(1.0 + 0.30 * score, 0.40, 1.30);
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

// Produce FEV1/FVC/PEF + percent-predicted for each, plus a sanity flag.
// If sanity fails, we fall back to the predicted values themselves
// (i.e., assume 100% predicted) and mark `sanityFallback: true`.
export function estimateSpirometry({ features, demographics }) {
  const predicted = hankinsonPredicted(demographics);

  const score = effortScore(features);
  const fraction = scoreToFraction(score);

  // All three parameters use the same fraction. Phone audio can't reliably
  // separate FEV1 / FVC / PEF effort independently. The sanity check still
  // enforces FVC >= FEV1 downstream.
  const fev1Frac = fraction;
  const fvcFrac  = fraction;
  const pefFrac  = fraction;

  let fev1 = predicted.fev1 * fev1Frac;
  let fvc  = predicted.fvc  * fvcFrac;
  let pef  = predicted.pef  * pefFrac;

  // Guarantee FVC >= FEV1 (physiologic constraint).
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
