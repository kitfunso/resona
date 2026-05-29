import test from 'node:test';
import assert from 'node:assert/strict';
import {
  atsFlags,
  classifierFallback,
  personalReportFallback,
  neuroReportFallback,
  heartReportFallback,
  scrubInternalTokens,
  scrubReport,
} from './reports.js';

// Unit tests for the deterministic report layer (closes audit TEST-1/TEST-2:
// the scrubber and the fallback generators were previously untested) and pins
// the index.js -> reports.js extraction as behaviour-preserving.

const reportShape = (r) => {
  assert.ok(typeof r.headline === 'string' && r.headline.length > 0, 'headline');
  assert.ok(typeof r.interpretation === 'string' && r.interpretation.length > 0, 'interpretation');
  assert.ok(Array.isArray(r.actions) && r.actions.length === 3, '3 actions');
  for (const a of r.actions) {
    assert.ok(typeof a.title === 'string' && a.title.length > 0, 'action.title');
    assert.ok(typeof a.detail === 'string' && a.detail.length > 0, 'action.detail');
  }
  assert.ok(typeof r.whenToWorry === 'string' && r.whenToWorry.length > 0, 'whenToWorry');
};

// --- scrubInternalTokens: every internal token must be replaced ---------------
test('scrubInternalTokens replaces every internal classification token', () => {
  const tokens = [
    'parkinsonian_like', 'essential_like',
    'tachycardia', 'bradycardia',
    'low_for_young_adult', 'high_for_older_adult',
    'low_snr', 'few_frames', 'few_beats', 'hr_methods_disagree', 'no_peak', 'fallback_roi',
  ];
  for (const tok of tokens) {
    const out = scrubInternalTokens(`the reading shows ${tok} today`);
    assert.ok(!out.includes(tok), `token "${tok}" must be scrubbed, got: ${out}`);
  }
  // 'physiological' only scrubbed when followed by punctuation/space boundary.
  assert.ok(!scrubInternalTokens('classification: physiological.').includes('physiological'));
  // non-strings pass through untouched.
  assert.equal(scrubInternalTokens(42), 42);
  assert.equal(scrubInternalTokens(null), null);
});

test('scrubReport mutates in place AND returns the same object, scrubbing all text fields', () => {
  const report = {
    headline: 'tachycardia detected',
    interpretation: 'shows essential_like pattern',
    whenToWorry: 'watch for bradycardia',
    actions: [{ title: 'parkinsonian_like note', detail: 'low_snr capture' }],
  };
  const returned = scrubReport(report);
  assert.equal(returned, report, 'must return the SAME reference (in-place)');
  assert.ok(!report.headline.includes('tachycardia'));
  assert.ok(!report.interpretation.includes('essential_like'));
  assert.ok(!report.whenToWorry.includes('bradycardia'));
  assert.ok(!report.actions[0].title.includes('parkinsonian_like'));
  assert.ok(!report.actions[0].detail.includes('low_snr'));
});

test('scrubReport tolerates non-objects and missing fields', () => {
  assert.equal(scrubReport(null), null);
  assert.equal(scrubReport('x'), 'x');
  const partial = { headline: 'tachycardia' }; // no actions array
  const out = scrubReport(partial);
  assert.ok(!out.headline.includes('tachycardia'));
});

// --- atsFlags -----------------------------------------------------------------
test('atsFlags flags late peak and short exhalation independently', () => {
  assert.deepEqual(atsFlags({ peakTimeSec: 0.2, activeSec05: 5 }), []);
  assert.deepEqual(atsFlags({ peakTimeSec: 0.9, activeSec05: 5 }), ['peak_late']);
  assert.deepEqual(atsFlags({ peakTimeSec: 0.2, activeSec05: 2 }), ['short_exhalation']);
  assert.deepEqual(atsFlags({ peakTimeSec: 0.9, activeSec05: 2 }), ['peak_late', 'short_exhalation']);
  // missing activeSec05 defaults to 0 -> short_exhalation.
  assert.deepEqual(atsFlags({ peakTimeSec: 0 }), ['short_exhalation']);
});

// --- classifierFallback: each invalid branch + the valid branch ---------------
test('classifierFallback returns the right reason per branch', () => {
  const est = { effortScore: 0 };
  assert.equal(classifierFallback({ features: { activeSec05: 0.5, peakEnv: 1 }, estimate: est }).reason, 'short_duration');
  assert.equal(classifierFallback({ features: { activeSec05: 2.0, peakEnv: 1 }, estimate: est }).reason, 'partial_sustain');
  assert.equal(classifierFallback({ features: { activeSec05: 3.0, peakEnv: 0.01 }, estimate: est }).reason, 'low_volume');
  assert.equal(
    classifierFallback({ features: { activeSec05: 3.0, peakEnv: 1 }, estimate: { effortScore: -1 } }).reason,
    'weak_effort',
  );
  const ok = classifierFallback({ features: { activeSec05: 4.0, peakEnv: 1, peakTimeSec: 0.1 }, estimate: est });
  assert.equal(ok.valid, true);
  assert.equal(ok.reason, 'valid_effort');
  assert.ok(Array.isArray(ok.atsFlags), 'carries atsFlags');
});

// --- personalReportFallback: below / normal / above %predicted ----------------
test('personalReportFallback branches on percent-predicted', () => {
  const mk = (fev1Pct) => personalReportFallback({
    estimate: { fev1: 3, fvc: 4, pef: 7, percentPredicted: { fev1: fev1Pct } },
  });
  const below = mk(70), normal = mk(95);
  reportShape(below); reportShape(normal);
  assert.match(below.headline, /lower than expected/i);
  assert.match(normal.headline, /in line/i);
  const high = mk(120);
  reportShape(high);
  assert.match(high.headline, /above the expected/i);
});

// --- neuroReportFallback: tremor classes --------------------------------------
test('neuroReportFallback branches on tremor classification', () => {
  const park = neuroReportFallback({ tremor: { classification: 'parkinsonian_like', dominantFrequencyHz: 4 }, gait: null });
  const ess = neuroReportFallback({ tremor: { classification: 'essential_like', dominantFrequencyHz: 8 }, gait: null });
  const phys = neuroReportFallback({ tremor: { classification: 'physiological', dominantFrequencyHz: 6 }, gait: { cadence: 100, stridesCv: 0.2 } });
  reportShape(park); reportShape(ess); reportShape(phys);
  // parkinsonian path must route the user to a GP.
  assert.ok(park.actions.some((a) => /GP/i.test(a.title) || /GP/i.test(a.detail)));
});

// --- heartReportFallback: HR classes ------------------------------------------
test('heartReportFallback branches on hrClassification', () => {
  const tachy = heartReportFallback({ heart: { hrBpm: 120, hrClassification: 'tachycardia' } });
  const brady = heartReportFallback({ heart: { hrBpm: 45, hrClassification: 'bradycardia' } });
  const unknown = heartReportFallback({ heart: { hrBpm: 0, hrClassification: 'unknown' } });
  const normal = heartReportFallback({ heart: { hrBpm: 70, hrClassification: 'normal' } });
  reportShape(tachy); reportShape(brady); reportShape(unknown); reportShape(normal);
  assert.match(tachy.interpretation, /above the typical/i);
  assert.match(brady.interpretation, /below the typical/i);
  assert.match(unknown.headline, /unclear/i);
});
