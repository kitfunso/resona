// A/B quality + latency eval across reasoning effort levels.
// - Narrator: 3 samples × {low, medium, high} = 9 calls (short output).
// - Personal report: 1 sample × {low, medium, high} = 3 calls (long output).
// Prints each output + per-call latency, so the human can judge quality.

import { performance } from 'node:perf_hooks';
import {
  NARRATOR_SYSTEM,
  buildNarratorUserMessage,
  PERSONAL_REPORT_SYSTEM,
  buildPersonalReportUserMessage,
} from '../server/prompts.js';
import { askGPTStream, askGPTJson } from '../server/gpt-service.js';

const LEVELS = ['low', 'medium', 'high'];

const narratorState = {
  participantCount: 12,
  totalLiters: 34.2,
  goalLiters: 100,
  flaggedCount: 2,
  newestBlowPct: 88,
  meanPercentPredicted: 96,
};

const reportInput = {
  estimate: {
    fev1: 2.84,
    fvc: 3.62,
    pef: 7.1,
    fev1FvcRatio: 0.78,
    percentPredicted: { fev1: 82, fvc: 88, pef: 79 },
    referenceStatus: 'NHANES III',
    referenceNote: 'Hankinson 1999 reference',
    ethnicityDirectMatch: true,
  },
  demographics: {
    name: 'Priya',
    ageYears: 34,
    sex: 'female',
    heightCm: 165,
    ethnicity: 'south-asian',
  },
  atsFlags: ['peak_late'],
};

async function timed(fn) {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: err.message, ms: Math.round(performance.now() - t0) };
  }
}

async function runNarrator(level) {
  return timed(async () => {
    let first = null;
    const t0 = performance.now();
    const full = await askGPTStream(
      [
        { role: 'system', content: NARRATOR_SYSTEM },
        { role: 'user', content: buildNarratorUserMessage(narratorState) },
      ],
      { tag: `eval-narrator-${level}`, reasoning: level },
      () => { if (first == null) first = Math.round(performance.now() - t0); },
    );
    return { first_delta_ms: first, text: full.trim() };
  });
}

async function runReport(level) {
  return timed(async () => {
    const obj = await askGPTJson(
      [
        { role: 'system', content: PERSONAL_REPORT_SYSTEM },
        { role: 'user', content: buildPersonalReportUserMessage(reportInput) },
      ],
      { tag: `eval-report-${level}`, reasoning: level },
    );
    return obj;
  });
}

function bar(label) {
  console.log('\n' + '='.repeat(70));
  console.log(label);
  console.log('='.repeat(70));
}

(async () => {
  bar('NARRATOR — 3 samples per level (room: 12 ppl, 34% of goal)');
  for (const level of LEVELS) {
    console.log(`\n--- reasoning=${level} ---`);
    for (let i = 1; i <= 3; i++) {
      const r = await runNarrator(level);
      if (r.ok) {
        console.log(
          `  [${i}] first:${String(r.value.first_delta_ms ?? '?').padStart(5)}ms  total:${String(r.ms).padStart(5)}ms  ${JSON.stringify(r.value.text)}`,
        );
      } else {
        console.log(`  [${i}] FAILED  total:${r.ms}ms  ${r.error}`);
      }
    }
  }

  bar('PERSONAL REPORT — 1 sample per level (34F Priya, FEV1 82%, peak_late flag)');
  for (const level of LEVELS) {
    console.log(`\n--- reasoning=${level} ---`);
    const r = await runReport(level);
    if (r.ok) {
      console.log(`  total:${r.ms}ms`);
      console.log(JSON.stringify(r.value, null, 2));
    } else {
      console.log(`  FAILED  total:${r.ms}ms  ${r.error}`);
    }
  }
})();
