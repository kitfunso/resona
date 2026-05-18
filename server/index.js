import express from 'express';
import cors from 'cors';
import http from 'node:http';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, askGLMJson, askGLMStream, isConfigured, AUTH_PATH } from './glm-service.js';
import {
  EFFORT_CLASSIFIER_SYSTEM,
  PERSONAL_REPORT_SYSTEM,
  GP_LETTER_SYSTEM,
  NEURO_REPORT_SYSTEM,
  HEART_REPORT_SYSTEM,
  NARRATOR_SYSTEM,
  buildClassifierUserMessage,
  buildPersonalReportUserMessage,
  buildGpLetterUserMessage,
  buildNeuroReportUserMessage,
  buildHeartReportUserMessage,
  buildNarratorUserMessage,
} from './prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DEMO_MODE = String(process.env.DEMO_MODE ?? '').toLowerCase() === 'true';

const db = new Database(':memory:');
db.pragma('journal_mode = MEMORY');
db.exec(`
  CREATE TABLE IF NOT EXISTS blows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    fev1 REAL NOT NULL,
    fvc REAL NOT NULL,
    pef REAL NOT NULL,
    percent_predicted REAL NOT NULL,
    flagged INTEGER NOT NULL DEFAULT 0
  );
`);

// -----------------------------------------------------------------------------
// Room aggregate state (ephemeral, cleared on restart).
//
// Per-device dedup: each browser/phone gets a stable sessionId (localStorage
// UUID) and the room keeps ONE entry per sessionId, storing the best FVC that
// device has posted. Re-blows from the same phone update that device's best
// rather than adding another row to the team total. Keeps the leaderboard
// ungameable by one over-eager participant.
// -----------------------------------------------------------------------------
const room = {
  // sessionId -> { bestFev1, bestFvc, bestPef, bestPct, flagged, teamCode, blowCount, lastTs }
  participants: new Map(),
  newestBlowPct: null,
  recentBlows: [], // chronological log of every blow incl. retries
  narratorLog: [], // last 5 narrator lines
  // Module 03 (Heart): sessionId -> { hrBpm, hrvRmssdMs, sdnnMs, quality, lastTs }
  heartParticipants: new Map(),
  newestHrBpm: null,
};

// Goal scales with the room. One typical FVC (3 L) per participant,
// with a small floor so the bar is visible before the first blow.
function goalLiters(count = room.participants.size) {
  return Math.max(30, count * 3);
}

function aggregateTeams() {
  const teams = new Map();
  for (const p of room.participants.values()) {
    if (!p.teamCode) continue;
    const t = teams.get(p.teamCode) || { count: 0, totalLiters: 0, pctSum: 0 };
    t.count += 1;
    t.totalLiters += p.bestFvc;
    t.pctSum += p.bestPct;
    teams.set(p.teamCode, t);
  }
  return teams;
}

function teamLeaderboard(limit = 3) {
  // Rank by mean percent-predicted so team size does not decide the winner.
  // A solo member at 105% beats a crowded team averaging 90%. Demographics
  // are already baked into percent-predicted so age/sex/height are fair.
  const teams = aggregateTeams();
  const entries = [];
  for (const [code, t] of teams.entries()) {
    entries.push({
      teamCode: code,
      count: t.count,
      totalLiters: t.totalLiters,
      meanPct: t.count > 0 ? t.pctSum / t.count : null,
    });
  }
  entries.sort((a, b) => (b.meanPct ?? -Infinity) - (a.meanPct ?? -Infinity));
  return entries.slice(0, limit);
}

function roomSnapshot() {
  let totalLiters = 0;
  let pctSum = 0;
  let flaggedCount = 0;
  for (const p of room.participants.values()) {
    totalLiters += p.bestFvc;
    pctSum += p.bestPct;
    if (p.flagged) flaggedCount += 1;
  }
  const participantCount = room.participants.size;
  const goal = goalLiters(participantCount);

  let hrSum = 0;
  let hrCountGood = 0;
  for (const h of room.heartParticipants.values()) {
    const grade = h.quality?.grade;
    if ((grade === 'good' || grade === 'fair') && Number.isFinite(h.hrBpm)) {
      hrSum += h.hrBpm;
      hrCountGood += 1;
    }
  }

  return {
    participantCount,
    totalLiters,
    meanPercentPredicted: participantCount > 0 ? pctSum / participantCount : null,
    flaggedCount,
    goalLiters: goal,
    progress: totalLiters / Math.max(1, goal),
    newestBlowPct: room.newestBlowPct,
    narratorLog: [...room.narratorLog],
    topTeams: teamLeaderboard(3),
    teamCount: aggregateTeams().size,
    model: MODEL,
    heart: {
      heartCount: room.heartParticipants.size,
      meanHrBpm: hrCountGood > 0 ? hrSum / hrCountGood : null,
      newestHrBpm: room.newestHrBpm,
    },
  };
}

function recordBlow({ sessionId, fev1, fvc, pef, percentPredicted, flagged, teamCode = null }) {
  // Fallback id for clients on old builds and for seedDemoMode synthetic blows.
  const id = sessionId || `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const prev = room.participants.get(id);
  const isFirstBlow = !prev;
  const improvedBest = isFirstBlow || fvc > prev.bestFvc;
  const previousBestFvc = prev?.bestFvc ?? 0;
  const fvcDelta = improvedBest ? fvc - previousBestFvc : 0;

  if (improvedBest) {
    room.participants.set(id, {
      bestFev1: fev1,
      bestFvc: fvc,
      bestPef: pef,
      bestPct: percentPredicted,
      flagged,
      teamCode: teamCode ?? prev?.teamCode ?? null,
      blowCount: (prev?.blowCount ?? 0) + 1,
      lastTs: Date.now(),
    });
  } else {
    room.participants.set(id, {
      ...prev,
      teamCode: teamCode ?? prev.teamCode,
      blowCount: prev.blowCount + 1,
      lastTs: Date.now(),
    });
  }

  room.newestBlowPct = percentPredicted;
  room.recentBlows.push({ fev1, fvc, pef, pct: percentPredicted, flagged, teamCode, ts: Date.now() });
  if (room.recentBlows.length > 50) room.recentBlows.shift();

  return { improvedBest, isFirstBlow, fvcDelta };
}

function recordHeart({ sessionId, hrBpm, hrvRmssdMs, sdnnMs, quality, teamCode = null }) {
  const id = sessionId || `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const prev = room.heartParticipants.get(id);
  const isFirstHeart = !prev;
  room.heartParticipants.set(id, {
    hrBpm,
    hrvRmssdMs,
    sdnnMs,
    quality,
    teamCode: teamCode ?? prev?.teamCode ?? null,
    heartCount: (prev?.heartCount ?? 0) + 1,
    lastTs: Date.now(),
  });
  if (quality?.grade === 'good' || quality?.grade === 'fair') room.newestHrBpm = hrBpm;
  return { isFirstHeart };
}

function pushNarratorLine(line) {
  if (!line) return;
  room.narratorLog.push({ line, ts: Date.now() });
  if (room.narratorLog.length > 5) room.narratorLog.shift();
}

// Optional demo seed, populates 30 synthetic-but-realistic blows at startup
// so the projector isn't empty when the pitch begins.
function seedDemoMode() {
  const rand = (min, max) => Math.random() * (max - min) + min;
  const normal = () => {
    // Box-Muller approximation
    const u1 = Math.max(1e-9, Math.random());
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  for (let i = 0; i < 30; i++) {
    const ageYears = Math.round(rand(22, 62));
    const heightCm = Math.round(rand(155, 190));
    const sex = Math.random() < 0.5 ? 'male' : 'female';
    // Healthy-ish predicted
    const predictedFev1 =
      sex === 'male' ? 0.5536 - 0.01303 * ageYears - 1.72e-4 * ageYears * ageYears + 1.4098e-4 * heightCm * heightCm
                     : 0.4333 - 0.00361 * ageYears - 1.94e-4 * ageYears * ageYears + 1.1496e-4 * heightCm * heightCm;
    const predictedFvc = predictedFev1 * 1.22;
    const pctDraw = Math.min(140, Math.max(55, 95 + normal() * 14));
    const fev1 = predictedFev1 * (pctDraw / 100);
    const fvc = predictedFvc * (pctDraw / 100);
    const pef = fev1 * 2.1;
    recordBlow({
      fev1,
      fvc,
      pef,
      percentPredicted: pctDraw,
      flagged: pctDraw < 80,
    });
  }
  const snap = roomSnapshot();
  console.log(`[Resona] demo mode seeded ${snap.participantCount} synthetic participants, totalLiters=${snap.totalLiters.toFixed(1)}`);
}

// -----------------------------------------------------------------------------
// Express + /health + /api/analyze-blow
// -----------------------------------------------------------------------------
const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    product: 'Resona',
    modules: ['Breath', 'Neuro', 'Heart'],
    tagline: 'Every body has a rhythm.',
    glm: { model: MODEL, configured: isConfigured(), auth_path: AUTH_PATH },
    db: 'sqlite-memory',
    demoMode: DEMO_MODE,
    room: roomSnapshot(),
    uptime_s: Math.round(process.uptime()),
  });
});

async function askGLMJsonWithRetry(messages, options) {
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await askGLMJson(messages, options);
    } catch (err) {
      lastErr = err;
      const msg = (err?.message || '').toLowerCase();
      const status = err?.status;
      const retryable =
        status === 429 ||
        msg.includes('connection') ||
        msg.includes('fetch failed') ||
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('socket hang up') ||
        msg.includes('rate limit');
      if (!retryable || attempt === maxAttempts) throw err;
      const delayMs = 800 * attempt;
      console.warn(`[glm-retry] ${options.tag}: attempt ${attempt} failed (${err.message}), waiting ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ATS 2019 informational flags (feasible subset on phone audio).
// - ATS says PEF should occur within 120ms of exhalation onset. Our peak-time
//   can't reliably resolve sub-120ms because the envelope is low-pass filtered
//   at 20Hz (50ms time constant). Use 500ms as the "clearly not a sharp burst"
//   threshold instead, which rules out speech and talking.
// - ATS says forced exhalation time ≥ 6s. Most phone blows end early; we flag
//   below 3.5s as "short" rather than hard-rejecting, since 3-6s is usable
//   for screening.
function atsFlags(features) {
  const flags = [];
  if (features.peakTimeSec > 0.5) flags.push('peak_late');
  if ((features.activeSec05 ?? 0) < 3.5) flags.push('short_exhalation');
  return flags;
}

function classifierFallback({ features, estimate }) {
  const sec = features.activeSec05 ?? 0;
  const peak = features.peakEnv ?? 0;
  if (sec < 1.0) {
    return {
      valid: false,
      reason: 'short_duration',
      coaching_message:
        'That was a very short blow. Take a deep breath first, then blow hard and steady for at least 4 seconds.',
      atsFlags: atsFlags(features),
    };
  }
  if (sec < 2.5) {
    return {
      valid: false,
      reason: 'partial_sustain',
      coaching_message:
        "You only sustained for a moment. Try to keep pushing air out steadily, don't stop until the countdown ends.",
      atsFlags: atsFlags(features),
    };
  }
  if (peak < 0.08) {
    return {
      valid: false,
      reason: 'low_volume',
      coaching_message:
        'We could barely hear you. Hold the bottom of the phone right to your lips and blow harder.',
      atsFlags: atsFlags(features),
    };
  }
  if (estimate.effortScore < -0.75) {
    return {
      valid: false,
      reason: 'weak_effort',
      coaching_message:
        'That looked sub-standard. Stand up, deep breath, and give it everything you have for the full 6 seconds.',
      atsFlags: atsFlags(features),
    };
  }
  return {
    valid: true,
    reason: 'valid_effort',
    coaching_message: 'Good blow.',
    atsFlags: atsFlags(features),
  };
}

function personalReportFallback({ estimate }) {
  const pp = Math.round(estimate.percentPredicted.fev1);
  const below = pp < 80;
  const above = pp > 115;

  const headline = below
    ? `Your FEV1 came in lower than expected.`
    : above
    ? `Your FEV1 came in above the expected range.`
    : `Your FEV1 is roughly in line with expectations.`;

  const interpretation =
    `You pushed out ${estimate.fev1.toFixed(2)} L in the first second (FEV1), ` +
    `${estimate.fvc.toFixed(2)} L in total (FVC), with a peak flow of ${estimate.pef.toFixed(2)} L/s. ` +
    `That is ${pp}% of the expected value for someone your age, sex, and height.`;

  const actions = below
    ? [
        { title: 'Book a GP appointment this week', detail: 'Mention these numbers and ask specifically for formal spirometry and, if relevant, a chest X-ray.' },
        { title: 'Skip smoking and vaping', detail: 'Nicotine and smoke worsen FEV1 noticeably within weeks. If you already smoke, NHS Stop Smoking services are free.' },
        { title: 'Track your breath for a month', detail: 'Note any new shortness of breath with exercise, morning cough, or wheezing to share with your GP.' },
      ]
    : above
    ? [
        { title: 'Keep doing what you are doing', detail: 'Regular cardio and healthy body weight keep your lungs in the top bracket for your age.' },
        { title: 'Do not start smoking or vaping', detail: 'These are the fastest ways to pull numbers like yours back down to average within a few years.' },
        { title: 'Treat this as a screening, not a record', detail: 'A phone microphone can over-read max effort. Real clinical spirometry may read 10-15% lower.' },
      ]
    : [
        { title: 'Get 150 minutes of cardio a week', detail: 'Brisk walking, cycling, or swimming maintains and slowly improves lung capacity.' },
        { title: 'Avoid smoking and vaping', detail: 'Even a few years of smoking shifts FEV1 trajectory. Clean air in = healthier numbers.' },
        { title: 'Re-check once a year', detail: 'A normal result today does not rule out future decline. An annual screen helps spot trends early.' },
      ];

  const whenToWorry = below
    ? 'See a GP promptly if you develop new shortness of breath, chest tightness, a persistent cough, or wheezing.'
    : 'See a GP if you notice sudden shortness of breath, new wheezing, or a cough that lasts more than three weeks.';

  return { headline, interpretation, actions, whenToWorry };
}

function gpLetterFallback({ demographics, estimate }) {
  const name = demographics.name?.trim() || 'This individual';
  const ppFev1 = Math.round(estimate.percentPredicted.fev1);
  const ppFvc = Math.round(estimate.percentPredicted.fvc);
  const ppPef = Math.round(estimate.percentPredicted.pef);
  const letter =
    `Dear GP,\n\n` +
    `${name} (${demographics.ageYears}, ${demographics.sex}, ${demographics.heightCm} cm) completed a ` +
    `phone-based acoustic spirometry screening at a public event.\n\n` +
    `FEV1: ${estimate.fev1.toFixed(2)} L (${ppFev1}% predicted)\n` +
    `FVC: ${estimate.fvc.toFixed(2)} L (${ppFvc}% predicted)\n` +
    `PEF: ${estimate.pef.toFixed(2)} L/s (${ppPef}% predicted)\n` +
    `FEV1/FVC ratio: ${estimate.fev1FvcRatio.toFixed(2)}\n\n` +
    `These values are derived from smartphone microphone audio using the Hankinson NHANES III ` +
    `reference equations. This is a screening tool, not clinical spirometry. Formal office ` +
    `spirometry is recommended if any concern.\n\n` +
    `Kind regards,\nResona Breath (acoustic screening tool)`;
  return { letter };
}

function neuroReportFallback({ tremor, gait }) {
  const isParkinsonian = tremor?.classification === 'parkinsonian_like';
  const isEssential = tremor?.classification === 'essential_like';
  const cadence = gait?.cadence ?? 0;
  const cvPct = (gait?.stridesCv ?? 0) * 100;

  const headline = isParkinsonian
    ? 'Low-frequency signal detected. Screening only.'
    : isEssential
    ? 'Slight higher-frequency tremor signature.'
    : 'Your Neuro screen looks as expected.';

  const freq = tremor?.dominantFrequencyHz != null ? tremor.dominantFrequencyHz.toFixed(1) : 'n/a';
  const interpretation =
    `Dominant arm-motion frequency landed at ${freq} Hz. ` +
    (gait
      ? `Walking cadence measured ${Math.round(cadence)} steps per minute with ${cvPct.toFixed(1)}% stride variability. `
      : '') +
    'These are screening numbers from a phone sensor, not clinical measurements.';

  const actions = isParkinsonian
    ? [
        { title: 'Book a GP appointment', detail: 'Describe the screening reading and mention any rest tremor, stiffness, or slowness you have noticed.' },
        { title: 'Track for a week', detail: 'Note when any hand shake happens. At rest? Holding objects? Under stress?' },
        { title: 'Cut late-day caffeine', detail: 'Caffeine can amplify baseline tremor. Stop after lunch for 7 days and retest.' },
      ]
    : isEssential
    ? [
        { title: 'Dial back caffeine', detail: 'Two coffees a day or fewer for a week. Essential-type signals often drop noticeably.' },
        { title: 'Sleep seven hours', detail: 'Fatigue and poor sleep amplify this pattern. Guard bedtime for seven nights.' },
        { title: 'Retest in a week', detail: 'If the signal persists at rest in quiet conditions, mention it to your GP.' },
      ]
    : cadence > 0 && cvPct > 15
    ? [
        { title: 'Add a 10-minute walk break', detail: 'Stride variability over 15% often comes from fragmented walking at work. Block a walk in your calendar.' },
        { title: 'Try a standing desk afternoon', detail: 'Alternate sitting and standing. Gentle movement at a standing desk resets posture.' },
        { title: 'Stretch hip flexors daily', detail: 'Tight hips shorten stride. 2 minutes morning and evening.' },
      ]
    : [
        { title: 'Keep movement regular', detail: 'Aim for a short walk every 60 minutes of desk time.' },
        { title: 'Try a walking meeting', detail: 'One meeting a day on foot keeps cadence strong.' },
        { title: 'Retest monthly', detail: 'Your numbers today form your personal baseline. Track the trend, not one reading.' },
      ];

  const whenToWorry = isParkinsonian
    ? 'See a GP soon if you notice a shake while your hand is fully at rest, especially on one side, or new stiffness and slower movements.'
    : 'See a GP if you develop unexplained falls, new persistent unsteadiness, or a tremor that does not fade within a week.';

  return { headline, interpretation, actions, whenToWorry };
}

function heartReportFallback({ heart }) {
  const hr = Math.round(heart?.hrBpm ?? 0);
  const hrvLine = Number.isFinite(heart?.hrvRmssdMs)
    ? `Your beat-to-beat variability was ${heart.hrvRmssdMs.toFixed(0)} milliseconds. `
    : '';
  const hrClass = heart?.hrClassification ?? 'normal';
  const ageNote = heart?.ageNote ?? null;

  if (hrClass === 'tachycardia') {
    return {
      headline: `Resting heart rate came in around ${hr} bpm.`,
      interpretation:
        `${hr} bpm sits above the typical resting range of 60 to 100 beats per minute. ` +
        hrvLine +
        'A 30-second phone reading often runs slightly high because being on camera lifts the heart rate. Retry seated, after a slow breath.',
      actions: [
        { title: 'Take a 5-minute seated reset', detail: 'Sit, slow your breath, then retake the reading in the same light.' },
        { title: 'Audit your caffeine timing', detail: 'Cut caffeine after lunch for 3 days and see if your resting reading settles.' },
        { title: 'Track across quiet readings', detail: 'If resting heart rate stays above 100 across several calm checks, mention it to your GP.' },
      ],
      whenToWorry:
        'See a GP if your resting heart rate stays above 100 across several quiet readings, or you notice palpitations, breathlessness at rest, or dizziness.',
    };
  }

  if (hrClass === 'bradycardia') {
    return {
      headline: `Resting heart rate came in around ${hr} bpm.`,
      interpretation:
        `${hr} bpm sits below the typical resting range of 60 to 100 beats per minute. ` +
        hrvLine +
        'A lower resting heart rate is often a fitness signature in healthy adults, especially with regular cardio.',
      actions: [
        { title: 'Keep your training going', detail: 'Regular endurance work commonly drops resting heart rate. A low number alone is rarely a concern.' },
        { title: 'Note any symptoms', detail: 'Watch for dizziness, fainting, or unexplained breathlessness. These are the signals that matter, not the number alone.' },
        { title: 'Retest after gentle activity', detail: 'Take another reading 10 minutes after a short walk. Resting heart rate often climbs slightly into the typical range.' },
      ],
      whenToWorry:
        'See a GP if you have unexplained dizziness, fainting, or breathlessness, especially with a heart rate that stays below 50.',
    };
  }

  if (hrClass === 'unknown') {
    return {
      headline: `Resting heart rate reading was unclear.`,
      interpretation:
        'The 30-second phone capture could not lock onto a clean pulse this time. ' +
        hrvLine +
        'Retry in brighter even light with your face held steady in the oval.',
      actions: [
        { title: 'Move into brighter light', detail: 'Daylight or a steady soft lamp beats variable indoor light for the camera.' },
        { title: 'Hold the phone steady', detail: 'Rest your elbows on a desk and keep your face centred in the oval for the full 30 seconds.' },
        { title: 'Retake in a quieter moment', detail: 'A calm pause, then a single clean attempt, usually beats several rushed retakes.' },
      ],
      whenToWorry:
        'See a GP if you notice palpitations, fainting, or chest discomfort, even without a clear reading from a phone screen.',
    };
  }

  const ageLine =
    ageNote === 'low_for_young_adult'
      ? ' A resting reading below 55 is common in fit young adults and is rarely a concern on its own.'
      : ageNote === 'high_for_older_adult'
      ? ' A resting reading above 90 after age 60 deserves a calmer retest and a GP conversation if it persists.'
      : '';

  return {
    headline: `Your resting heart rate landed around ${hr} bpm.`,
    interpretation:
      `${hr} bpm sits within the typical resting range of 60 to 100 beats per minute. ` +
      hrvLine +
      'A phone-camera reading is a screening number, not a clinical measurement.' +
      ageLine,
    actions: [
      { title: 'Take a walking break every hour', detail: 'Set a 50-minute timer at the desk, walk for 5. Hourly movement keeps resting heart rate and recovery in a good place.' },
      { title: 'Aim for seven hours of sleep', detail: 'Short sleep raises resting heart rate within a day or two. Guard the seven hours for the next week.' },
      { title: 'Retest on a quiet Monday', detail: 'Build a baseline. Take the same screen at the same time of day to see your honest trend.' },
    ],
    whenToWorry:
      'See a GP if you notice sudden palpitations, fainting, or chest discomfort, or if you feel unusually breathless climbing one flight of stairs.',
  };
}

// Defensive scrub: strip internal classification tokens that should never
// appear in user-facing narrative. Belt-and-braces against GLM ignoring the
// "never echo these tokens" rule in the system prompt.
function scrubInternalTokens(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\bparkinsonian_like\b/gi, 'a low-frequency tremor signal')
    .replace(/\bessential_like\b/gi, 'a slightly higher-frequency tremor signal')
    .replace(/\bphysiological\b(?=[\s.,:;])/gi, 'the expected everyday tremor pattern')
    .replace(/\btachycardia\b/gi, 'a higher resting heart rate')
    .replace(/\bbradycardia\b/gi, 'a lower resting heart rate')
    .replace(/\blow_for_young_adult\b/gi, 'lower than the typical young adult range')
    .replace(/\bhigh_for_older_adult\b/gi, 'higher than the typical older adult range')
    .replace(/\b(low_snr|few_frames|few_beats|hr_methods_disagree|no_peak|fallback_roi)\b/gi, 'a noisy reading');
}

function scrubReport(report) {
  if (!report || typeof report !== 'object') return report;
  if (report.headline) report.headline = scrubInternalTokens(report.headline);
  if (report.interpretation) report.interpretation = scrubInternalTokens(report.interpretation);
  if (report.whenToWorry) report.whenToWorry = scrubInternalTokens(report.whenToWorry);
  if (Array.isArray(report.actions)) {
    for (const a of report.actions) {
      if (a?.title) a.title = scrubInternalTokens(a.title);
      if (a?.detail) a.detail = scrubInternalTokens(a.detail);
    }
  }
  return report;
}

app.post('/api/analyze-neuro', async (req, res) => {
  const { tremor, gait, demographics } = req.body || {};
  if (!tremor && !gait) {
    return res.status(400).json({ error: 'need at least one of tremor or gait' });
  }

  let report;
  let source = 'ai';
  try {
    report = await askGLMJsonWithRetry(
      [
        { role: 'system', content: NEURO_REPORT_SYSTEM },
        { role: 'user', content: buildNeuroReportUserMessage({ tremor, gait, demographics }) },
      ],
      { tag: 'neuro-report', temperature: 0.8, max_tokens: 2000 },
    );
    if (!report?.headline || !Array.isArray(report?.actions)) {
      report = neuroReportFallback({ tremor, gait });
      source = 'fallback';
    }
  } catch (err) {
    console.warn(`[analyze-neuro] failed: ${err.message}`);
    report = neuroReportFallback({ tremor, gait });
    source = 'fallback';
  }
  report.source = source;
  scrubReport(report);
  res.json({ ok: true, report });
});

app.post('/api/analyze-heart', async (req, res) => {
  const { heart, demographics, sessionId } = req.body || {};
  if (!heart || typeof heart !== 'object') {
    return res.status(400).json({ error: 'missing heart payload' });
  }
  if (!Number.isFinite(heart.hrBpm)) {
    return res.status(400).json({ error: 'heart.hrBpm must be a finite number' });
  }

  const teamCode = typeof demographics?.teamCode === 'string' && demographics.teamCode.length > 0
    ? demographics.teamCode.toUpperCase().slice(0, 6)
    : null;

  recordHeart({
    sessionId,
    hrBpm: heart.hrBpm,
    hrvRmssdMs: heart.hrvRmssdMs ?? null,
    sdnnMs: heart.sdnnMs ?? null,
    quality: heart.quality ?? { grade: 'unknown', reasons: [] },
    teamCode,
  });

  if (heart.quality?.grade === 'poor') {
    return res.json({
      ok: false,
      coaching: {
        message:
          'We could not read a clean pulse from your camera. Move into brighter, even light, hold still with your face centred in the oval, and try again.',
      },
    });
  }

  let report;
  let source = 'ai';
  try {
    report = await askGLMJsonWithRetry(
      [
        { role: 'system', content: HEART_REPORT_SYSTEM },
        { role: 'user', content: buildHeartReportUserMessage({ heart, demographics }) },
      ],
      { tag: 'heart-report', temperature: 0.8, max_tokens: 2000 },
    );
    if (!report?.headline || !Array.isArray(report?.actions)) {
      report = heartReportFallback({ heart });
      source = 'fallback';
    }
  } catch (err) {
    console.warn(`[analyze-heart] failed: ${err.message}`);
    report = heartReportFallback({ heart });
    source = 'fallback';
  }
  report.source = source;
  scrubReport(report);
  res.json({ ok: true, report });
});

app.post('/api/admin/reset', (req, res) => {
  room.participants.clear();
  room.heartParticipants.clear();
  room.newestBlowPct = null;
  room.newestHrBpm = null;
  room.recentBlows.length = 0;
  room.narratorLog.length = 0;
  broadcastToProjectors({ type: 'state', state: roomSnapshot(), resetAt: Date.now() });
  console.log('[Resona] room state reset via /api/admin/reset');
  res.json({ ok: true, state: roomSnapshot() });
});

app.post('/api/analyze-blow', async (req, res) => {
  const { features, estimate, demographics, sessionId } = req.body || {};
  if (!features || !estimate || !demographics) {
    return res.status(400).json({ error: 'missing features, estimate, or demographics' });
  }
  if (!demographics.sex || !demographics.ageYears || !demographics.heightCm) {
    return res.status(400).json({ error: 'demographics requires sex, ageYears, heightCm' });
  }

  const classification = classifierFallback({ features, estimate });
  if (!classification?.valid) {
    return res.json({
      valid: false,
      reason: classification?.reason || 'unknown',
      coachingMessage: classification?.coaching_message || 'That did not look like a valid blow. Try again.',
    });
  }

  const flags = atsFlags(features);

  const flagged = estimate.percentPredicted.fev1 < 80;
  const teamCode = typeof demographics.teamCode === 'string' && demographics.teamCode.length > 0
    ? demographics.teamCode.toUpperCase().slice(0, 6)
    : null;
  recordBlow({
    sessionId,
    fev1: estimate.fev1,
    fvc: estimate.fvc,
    pef: estimate.pef,
    percentPredicted: estimate.percentPredicted.fev1,
    flagged,
    teamCode,
  });

  // LLM calls (sequential + retry + fallback)
  let personalReport;
  let personalReportSource = 'ai';
  try {
    personalReport = await askGLMJsonWithRetry(
      [
        { role: 'system', content: PERSONAL_REPORT_SYSTEM },
        { role: 'user', content: buildPersonalReportUserMessage({ estimate, demographics, atsFlags: flags }) },
      ],
      { tag: 'personal-report', temperature: 0.8, max_tokens: 2000 },
    );
    if (!personalReport?.headline) {
      personalReport = personalReportFallback({ estimate });
      personalReportSource = 'fallback';
    }
  } catch (err) {
    console.warn(`[analyze-blow] personal report failed: ${err.message}`);
    personalReport = personalReportFallback({ estimate });
    personalReportSource = 'fallback';
  }
  personalReport.source = personalReportSource;

  let gpLetterObj;
  let gpLetterSource = 'ai';
  try {
    gpLetterObj = await askGLMJsonWithRetry(
      [
        { role: 'system', content: GP_LETTER_SYSTEM },
        { role: 'user', content: buildGpLetterUserMessage({ estimate, demographics, atsFlags: flags }) },
      ],
      { tag: 'gp-letter', temperature: 0.3, max_tokens: 2500 },
    );
    if (!gpLetterObj?.letter) {
      gpLetterObj = gpLetterFallback({ demographics, estimate });
      gpLetterSource = 'fallback';
    }
  } catch (err) {
    console.warn(`[analyze-blow] GP letter failed: ${err.message}`);
    gpLetterObj = gpLetterFallback({ demographics, estimate });
    gpLetterSource = 'fallback';
  }

  try {
    db.prepare(
      'INSERT INTO blows (created_at, fev1, fvc, pef, percent_predicted, flagged) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      new Date().toISOString(),
      estimate.fev1,
      estimate.fvc,
      estimate.pef,
      estimate.percentPredicted.fev1,
      flagged ? 1 : 0,
    );
  } catch (err) {
    console.warn(`[analyze-blow] sqlite insert failed: ${err.message}`);
  }

  res.json({
    valid: true,
    classification,
    atsFlags: classification.atsFlags || [],
    personalReport,
    gpLetter: gpLetterObj.letter,
    gpLetterSource,
  });
});

// -----------------------------------------------------------------------------
// HTTP server
// -----------------------------------------------------------------------------
const server = http.createServer(app);

// -----------------------------------------------------------------------------
// NARRATOR loop, fires every 6s while participants exist.
// -----------------------------------------------------------------------------
const NARRATOR_INTERVAL_MS = 6000;
let narratorInFlight = false;

async function runNarratorTick() {
  if (narratorInFlight) return;
  if (room.participants.size === 0) return;
  if (projectorSockets.size === 0) return; // no one listening, save the tokens

  narratorInFlight = true;
  const streamId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    const snapshot = roomSnapshot();
    broadcastToProjectors({ type: 'narrator_start', streamId });
    const full = await askGLMStream(
      [
        { role: 'system', content: NARRATOR_SYSTEM },
        { role: 'user', content: buildNarratorUserMessage(snapshot) },
      ],
      // Narrator is ambient hype, not revenue. `low` matched `high` quality in
      // the eval at 2-3x speed, and stays inside the 6s tick without backing up.
      { tag: 'narrator', reasoning: 'low' },
      (delta) => {
        broadcastToProjectors({ type: 'narrator_delta', streamId, delta });
      },
    );
    const line = full.trim().replace(/^"+|"+$/g, '');
    if (line) {
      pushNarratorLine(line);
      broadcastToProjectors({ type: 'narrator', streamId, line, state: roomSnapshot() });
    } else {
      broadcastToProjectors({ type: 'narrator_cancel', streamId });
    }
  } catch (err) {
    console.warn(`[narrator] tick failed: ${err.message}`);
    broadcastToProjectors({ type: 'narrator_cancel', streamId });
  } finally {
    narratorInFlight = false;
  }
}

setInterval(runNarratorTick, NARRATOR_INTERVAL_MS);

if (DEMO_MODE) seedDemoMode();

server.listen(PORT, () => {
  console.log(`[Resona] server listening on :${PORT}`);
  console.log(`[Resona] Codex model pinned: ${MODEL} (auth: ${isConfigured() ? 'ready' : 'MISSING — run `codex login`'})`);
  console.log(`[Resona] demo mode: ${DEMO_MODE ? 'ON (seeded)' : 'off'}`);
});
