import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { migrate, pool } from './db.js';
import { requestCode, verifyCode, issueSession, SESSION_COOKIE, SESSION_TTL_SEC_OUT } from './auth.js';
import { requireAuth, requireOrgAdmin, loadCurrentUser } from './middleware-auth.js';
import { orgParticipation, modalityDistribution, SUPPRESSED, MIN_GROUP } from './aggregates.js';
import { MODEL, askGLMJson, isConfigured } from './llm.js';
import {
  EFFORT_CLASSIFIER_SYSTEM,
  PERSONAL_REPORT_SYSTEM,
  NEURO_REPORT_SYSTEM,
  HEART_REPORT_SYSTEM,
  buildClassifierUserMessage,
  buildPersonalReportUserMessage,
  buildNeuroReportUserMessage,
  buildHeartReportUserMessage,
  buildDemographics,
} from './prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const authRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

const authVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts; try again later' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Tests bypass the per-IP limit because they hit 127.0.0.1 from the same
  // process at high throughput. Production traffic never sets NODE_ENV=test.
  skip: () => process.env.NODE_ENV === 'test',
});

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// -----------------------------------------------------------------------------
// Express + /health + /api/analyze-blow
// -----------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS not allowed'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    product: 'Resona',
    modules: ['Breath', 'Neuro', 'Heart'],
    tagline: 'Every body has a rhythm.',
    glm: { model: MODEL, configured: isConfigured() },
    db: 'postgres',
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

app.post('/api/analyze-neuro', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex) {
    return res.status(400).json({ error: 'profile incomplete; PATCH /api/me first' });
  }

  const { tremor, gait } = req.body || {};
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
  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'motion', $3::jsonb)`,
      [req.auth.userId, user.org_id, JSON.stringify({ tremor: req.body.tremor, gait: req.body.gait, neuroReport: report })],
    );
  } catch (err) {
    console.error('[analyze-neuro] check_ins persist failed:', err.message);
  }
  res.json({ ok: true, report });
});

app.post('/api/analyze-heart', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex) {
    return res.status(400).json({ error: 'profile incomplete; PATCH /api/me first' });
  }

  const { heart } = req.body || {};
  if (!heart || typeof heart !== 'object') {
    return res.status(400).json({ error: 'missing heart payload' });
  }
  if (!Number.isFinite(heart.hrBpm)) {
    return res.status(400).json({ error: 'heart.hrBpm must be a finite number' });
  }

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
  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'heart', $3::jsonb)`,
      [req.auth.userId, user.org_id, JSON.stringify({ heart: req.body.heart, heartReport: report })],
    );
  } catch (err) {
    console.error('[analyze-heart] check_ins persist failed:', err.message);
  }
  res.json({ ok: true, report });
});

app.post('/api/analyze-blow', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex || !demographics.heightCm) {
    return res.status(400).json({ error: 'profile incomplete; PATCH /api/me first' });
  }

  const { features, estimate, sessionId } = req.body || {};
  if (!features || !estimate) {
    return res.status(400).json({ error: 'missing features or estimate' });
  }
  // Validate the estimate shape up front: classifierFallback and
  // personalReportFallback dereference these fields, and a malformed body
  // would otherwise throw deep in a handler and crash the process.
  if (
    !Number.isFinite(estimate.fev1) ||
    !Number.isFinite(estimate.fvc) ||
    !Number.isFinite(estimate.pef) ||
    !Number.isFinite(estimate.effortScore) ||
    !estimate.percentPredicted ||
    !Number.isFinite(estimate.percentPredicted.fev1)
  ) {
    return res.status(400).json({ error: 'malformed estimate' });
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

  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'breath', $3::jsonb)`,
      [req.auth.userId, user.org_id, JSON.stringify({ features: req.body.features, estimate, atsFlags: flags, personalReport })],
    );
  } catch (err) {
    console.error('[analyze-blow] check_ins persist failed:', err.message);
  }
  res.json({
    valid: true,
    classification,
    atsFlags: classification.atsFlags || [],
    personalReport,
  });
});

app.post('/api/auth/request', authRequestLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  if (!email.includes('@')) return res.status(400).json({ error: 'invalid email' });
  try {
    await requestCode(email);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/request]', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/api/auth/verify', authVerifyLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'invalid input' });
  }
  try {
    const session = await verifyCode(email, code);
    const token = await issueSession({ userId: session.userId, orgId: session.orgId });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SEC_OUT * 1000,
      path: '/',
    });
    res.json({ ok: true, email: session.email });
  } catch (err) {
    res.status(401).json({ error: 'invalid or expired code' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user });
});

const SEX_VALUES = new Set(['male', 'female', 'intersex', 'other', 'prefer-not-to-say']);
const ETHNICITY_VALUES = new Set([
  'Caucasian', 'African', 'African-American', 'Hispanic', 'East Asian',
  'South Asian', 'Southeast Asian', 'Middle Eastern', 'Indigenous', 'Mixed', 'Other',
]);

// Module-scoped cap for GET /api/me/check-ins. Behaviour is "clamp, never
// 400": invalid input degrades to the default 50, matching the existing
// PATCH /api/me tolerance for partial / malformed payloads.
const ME_CHECK_INS_DEFAULT_LIMIT = 50;
const ME_CHECK_INS_MAX_LIMIT = 200;

app.patch('/api/me', requireAuth, async (req, res) => {
  const { name, dob, heightCm, sex, ethnicity } = req.body ?? {};
  const allowed = {};
  if (typeof name === 'string') {
    const cleaned = name.replace(/[^\p{L}\p{M} .'\-]/gu, '').slice(0, 200).trim();
    if (cleaned.length > 0) allowed.name = cleaned;
  }
  if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    const d = new Date(`${dob}T00:00:00Z`);
    const yr = d.getUTCFullYear();
    if (!Number.isNaN(d.getTime()) && yr >= 1900 && d.getTime() <= Date.now()) {
      allowed.dob = dob;
    }
  }
  if (Number.isInteger(heightCm) && heightCm > 50 && heightCm < 250) allowed.height_cm = heightCm;
  if (typeof sex === 'string' && SEX_VALUES.has(sex)) allowed.sex = sex;
  if (typeof ethnicity === 'string' && ETHNICITY_VALUES.has(ethnicity)) allowed.ethnicity = ethnicity;
  const keys = Object.keys(allowed);
  if (keys.length === 0) return res.json({ user: await loadCurrentUser(req.auth.userId) });
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => allowed[k]);
  values.push(req.auth.userId);
  try {
    await pool.query(`UPDATE users SET ${setClause} WHERE id = $${values.length}`, values);
  } catch (err) {
    if (err.code === '22008' || err.code === '22007') {
      return res.status(400).json({ error: 'invalid date' });
    }
    throw err;
  }
  res.json({ user: await loadCurrentUser(req.auth.userId) });
});

// Personal check-in history. requireAuth is sufficient gating: this is an
// authed personal-history read scoped to req.auth.userId, and auth_codes
// already rate-limits the path to acquire a session, so no additional
// limiter is layered on. The handler returns an explicit allowlist of
// fields per row; the raw check_ins.payload JSONB is projected per-kind
// in SQL and never leaves the server wholesale (Article 5(1)(c)).
app.get('/api/me/check-ins', requireAuth, async (req, res) => {
  const rawLimit = req.query.limit;
  const parsed = Number.parseInt(rawLimit, 10);
  let limit;
  if (!Number.isFinite(parsed) || parsed < 1) {
    limit = ME_CHECK_INS_DEFAULT_LIMIT;
  } else if (parsed > ME_CHECK_INS_MAX_LIMIT) {
    limit = ME_CHECK_INS_MAX_LIMIT;
  } else {
    limit = parsed;
  }
  try {
    const { rows } = await pool.query(
      `SELECT
         id,
         kind,
         created_at,
         CASE kind
           WHEN 'breath' THEN payload->'personalReport'->>'headline'
           WHEN 'motion' THEN payload->'neuroReport'->>'headline'
           WHEN 'heart'  THEN payload->'heartReport'->>'headline'
           ELSE NULL
         END AS headline
       FROM check_ins
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.auth.userId, limit],
    );
    const checkIns = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      headline: row.headline,
    }));
    res.json({
      checkIns,
      limit,
      truncated: checkIns.length === limit,
    });
  } catch (err) {
    console.error('[me/check-ins]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// -----------------------------------------------------------------------------
// Admin bootstrap endpoints
// -----------------------------------------------------------------------------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (ADMIN_TOKEN && ADMIN_TOKEN.length < 32) {
  throw new Error('ADMIN_TOKEN must be at least 32 chars');
}
const ADMIN_TOKEN_BUF = ADMIN_TOKEN ? Buffer.from(ADMIN_TOKEN) : null;

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN_BUF) return res.status(503).json({ error: 'admin disabled' });
  const provided = req.headers['x-admin-token'];
  if (typeof provided !== 'string') return res.status(401).json({ error: 'unauthorized' });
  const providedBuf = Buffer.from(provided);
  if (providedBuf.length !== ADMIN_TOKEN_BUF.length) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!crypto.timingSafeEqual(providedBuf, ADMIN_TOKEN_BUF)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/api/admin/orgs', adminLimiter, requireAdmin, async (req, res) => {
  const { slug, name, firstUserEmail } = req.body ?? {};
  if (typeof slug !== 'string' || !/^[a-z0-9-]{2,40}$/.test(slug)) {
    return res.status(400).json({ error: 'invalid slug (lowercase, digits, hyphens, 2-40 chars)' });
  }
  if (typeof name !== 'string' || name.length < 1) {
    return res.status(400).json({ error: 'invalid name' });
  }
  if (typeof firstUserEmail !== 'string' || !firstUserEmail.includes('@')) {
    return res.status(400).json({ error: 'invalid firstUserEmail' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: orgs } = await client.query(
      'INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id',
      [slug, name],
    );
    const { rows: users } = await client.query(
      'INSERT INTO users (org_id, email) VALUES ($1, lower($2)) RETURNING id, email',
      [orgs[0].id, firstUserEmail],
    );
    await client.query('COMMIT');
    res.json({ org: { id: orgs[0].id, slug, name }, firstUser: users[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'slug or email already exists' });
    console.error('[admin/orgs]', err);
    res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/users', adminLimiter, requireAdmin, async (req, res) => {
  const { orgSlug, email } = req.body ?? {};
  if (typeof orgSlug !== 'string' || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid input' });
  }
  const { rows: orgs } = await pool.query('SELECT id FROM orgs WHERE slug = $1', [orgSlug]);
  if (orgs.length === 0) return res.status(404).json({ error: 'org not found' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (org_id, email) VALUES ($1, lower($2)) RETURNING id, email',
      [orgs[0].id, email],
    );
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'email already exists' });
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// Allowlist for role values. Mirrors the CHECK constraint on users.role and
// role_grants.granted_role from 003_admin.sql. Keep in sync if either CHECK
// changes.
const ROLE_VALUES = new Set(['member', 'admin']);

// Match a UUID shape before any DB call so a malformed :id param returns a
// clean 400 instead of PG 22P02 (invalid_text_representation) escaping as a
// generic 500. Loose v1..v8 shape, case-insensitive; the DB lookup still
// 404s on a well-formed UUID that doesn't exist.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Team name validation mirrored from 003_admin.sql's teams.name CHECK. The
// handler validates ahead of the insert so the friendly 400 fires before a
// 23514 surfaces from the constraint.
const TEAM_NAME_RE = /^[A-Za-z0-9 .,&'\-]+$/;
function isValidTeamName(name) {
  return typeof name === 'string'
    && name.length >= 1
    && name.length <= 80
    && TEAM_NAME_RE.test(name);
}

app.post('/api/admin/users/:id/role', adminLimiter, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const { role } = req.body ?? {};
  if (typeof role !== 'string' || !ROLE_VALUES.has(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  const { rows: existing } = await pool.query(
    'SELECT id, email, role FROM users WHERE id = $1',
    [id],
  );
  if (existing.length === 0) return res.status(404).json({ error: 'user not found' });
  const current = existing[0];
  if (current.role === role) {
    // No-op: role unchanged, no audit row written. Spec A2 Step 1 contract.
    return res.json({ user: { id: current.id, email: current.email, role: current.role } });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
    await client.query(
      `INSERT INTO role_grants (user_id, granted_role, granted_by)
       VALUES ($1, $2, 'admin_token')`,
      [id, role],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/role]', err);
    return res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
  console.info(`[role-grant] user=${id} role=${role} by=admin_token`);
  res.json({ user: { id: current.id, email: current.email, role } });
});

app.post('/api/admin/teams', adminLimiter, requireAdmin, async (req, res) => {
  const { orgSlug, name } = req.body ?? {};
  if (typeof orgSlug !== 'string') {
    return res.status(400).json({ error: 'invalid input' });
  }
  if (!isValidTeamName(name)) {
    return res.status(400).json({ error: 'invalid name' });
  }
  const { rows: orgs } = await pool.query('SELECT id FROM orgs WHERE slug = $1', [orgSlug]);
  if (orgs.length === 0) return res.status(404).json({ error: 'org not found' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO teams (org_id, name) VALUES ($1, $2)
       RETURNING id, org_id, name, created_at`,
      [orgs[0].id, name],
    );
    res.status(201).json({ team: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'team name already exists in this org' });
    }
    console.error('[admin/teams]', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/api/admin/teams/:id/members', adminLimiter, requireAdmin, async (req, res) => {
  const { id: teamId } = req.params;
  if (!UUID_RE.test(teamId)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const { userEmail } = req.body ?? {};
  if (typeof userEmail !== 'string' || !userEmail.includes('@')) {
    return res.status(400).json({ error: 'invalid input' });
  }
  const { rows: teams } = await pool.query(
    'SELECT id, org_id FROM teams WHERE id = $1',
    [teamId],
  );
  if (teams.length === 0) return res.status(404).json({ error: 'team not found' });
  const team = teams[0];
  const { rows: users } = await pool.query(
    'SELECT id, org_id FROM users WHERE lower(email) = lower($1)',
    [userEmail],
  );
  if (users.length === 0) return res.status(404).json({ error: 'user not found' });
  const user = users[0];
  // Friendlier 400 ahead of the schema-level 23503. Defence-in-depth: the
  // composite FK on team_memberships still rejects the insert below if a
  // future caller skips this check.
  if (user.org_id !== team.org_id) {
    return res.status(400).json({ error: 'cross-org add' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO team_memberships (user_id, team_id, org_id)
       VALUES ($1, $2, $3)
       RETURNING user_id, team_id, org_id, created_at`,
      [user.id, team.id, team.org_id],
    );
    res.status(201).json({ membership: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'already a member' });
    // 23503 from the composite FK means an attempted cross-org row that the
    // handler check above missed. Map to the same 400 so the contract stays
    // consistent. Do NOT catch 23P01 here: that is a serialisation failure,
    // not a tenant signal, and should bubble to a 500.
    if (err.code === '23503') return res.status(400).json({ error: 'cross-org add' });
    console.error('[admin/teams/members]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// -----------------------------------------------------------------------------
// Phase B Task B2: admin aggregate reads (min-N=5 suppressed)
// -----------------------------------------------------------------------------
// All three routes mounted as requireAuth + requireOrgAdmin. org_id is sourced
// EXCLUSIVELY from req.currentUser.org_id (the JWT-derived users-row join from
// E2's requireOrgAdmin); never from request body or query.
//
// Article 9 special-category employer-as-controller surface. See
// server/aggregates.js for MIN_GROUP, the SUPPRESSED sentinel discriminant,
// the frozen BANDS table, and the three suppression layers.

// parseDays enforces the ?days input contract for the aggregate routes:
// integer in [1, 365], default 30, REJECT anything else with 400. We do
// not silently clamp - clamping hides client bugs and a 36500-day query
// is a DoS surface combined with finer-slice triangulation.
const DAYS_MIN = 1;
const DAYS_MAX = 365;
const DAYS_DEFAULT = 30;
function parseDays(rawValue) {
  if (rawValue === undefined) return { value: DAYS_DEFAULT };
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return { error: 'days must be integer in [1,365]' };
  }
  // Strict integer regex: no decimals, no leading +, no leading 0 except '0',
  // no scientific notation. parseInt is too permissive (e.g. '30foo' -> 30).
  if (!/^(0|[1-9][0-9]*)$/.test(rawValue)) {
    return { error: 'days must be integer in [1,365]' };
  }
  const n = Number(rawValue);
  if (n < DAYS_MIN || n > DAYS_MAX) {
    return { error: 'days must be integer in [1,365]' };
  }
  return { value: n };
}

// adminAuditRead emits a [admin-read] line on every successful aggregate
// read. UK GDPR Art 5(2) accountability: read-side mirror of [admin-deny]
// (requireOrgAdmin) and [role-grant] (Phase A). Information disclosed is
// bounded by what's already in the HTTP access log; adding user_id +
// org_id is what makes the trail useful for incident review.
function adminAuditRead(req) {
  console.info(
    `[admin-read] user=${req.currentUser.id} org=${req.currentUser.org_id} path=${req.method} ${req.originalUrl}`,
  );
}

// GET /api/admin/overview?days=30
// Returns participation + per-modality distribution for the whole org.
// adminLimiter applies the same 20 req/min cap as the bootstrap POST
// endpoints; this is the differential-probe mitigation - without it an
// admin could call ?days=1, ?days=2, ..., ?days=365 to triangulate
// per-day check-in deltas and defeat MIN_GROUP suppression.
app.get('/api/admin/overview', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  const days = parseDays(req.query.days);
  if (days.error) return res.status(400).json({ error: days.error });
  const orgId = req.currentUser.org_id;
  try {
    // Parallelise the four independent queries (participation + 3 modalities).
    const [participation, breath, motion, heart] = await Promise.all([
      orgParticipation(orgId, days.value),
      modalityDistribution(orgId, 'breath', days.value),
      modalityDistribution(orgId, 'motion', days.value),
      modalityDistribution(orgId, 'heart',  days.value),
    ]);
    adminAuditRead(req);
    res.json({ participation, distributions: { breath, motion, heart } });
  } catch (err) {
    console.error('[admin/overview]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// GET /api/admin/teams
// Returns the org's teams with per-team member counts (suppressed if a team
// has fewer than MIN_GROUP members - a team of 3 is itself identifying;
// suppress(count, count) uses the count both as value and as threshold by
// design - the count itself is the identifying signal).
app.get('/api/admin/teams', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = req.currentUser.org_id;
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name,
              (SELECT COUNT(*)::int FROM team_memberships
                WHERE team_id = t.id AND org_id = t.org_id) AS member_count
         FROM teams t
        WHERE t.org_id = $1
        ORDER BY lower(t.name) ASC`,
      [orgId],
    );
    // suppress count itself - a team of <5 has a count that re-identifies.
    // value === n by design: the count is both the value we'd show and the
    // threshold gate.
    const teams = rows.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: row.member_count < MIN_GROUP
        ? SUPPRESSED
        : row.member_count,
    }));
    adminAuditRead(req);
    res.json({ teams });
  } catch (err) {
    console.error('[admin/teams]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// GET /api/admin/teams/:id/overview?days=30
// Team-scoped variant of /overview. The 404 response is BYTE-IDENTICAL for
// three cases (status, headers we control, body):
//   (a) :id is a malformed UUID
//   (b) :id is a well-formed UUID that doesn't exist anywhere
//   (c) :id is a well-formed UUID that exists but belongs to another org
// Distinguishable status codes here would let an org-A admin enumerate team
// UUIDs across the system. Timing-channel distinguishability is out of
// scope at this threat level (the cost-benefit of equalising via sentinel
// SELECTs is poor relative to GDPR's actual concerns); status + body are
// the surfaces we hold equal.
const NOT_FOUND_BODY = { error: 'not found' };
app.get('/api/admin/teams/:id/overview', adminLimiter, requireAuth, requireOrgAdmin, async (req, res) => {
  // Order matters: parse days BEFORE the UUID check so a malformed-days
  // query returns 400 regardless of UUID shape. If UUID-check ran first,
  // a malformed UUID + malformed days would return 404 while a valid UUID +
  // malformed days returns 400 - a distinguishability leak (an attacker
  // could probe ?days=foo to detect UUID well-formedness).
  const days = parseDays(req.query.days);
  if (days.error) return res.status(400).json({ error: days.error });

  const teamId = req.params.id;
  // Regex-validate BEFORE the SELECT so a malformed id returns the same 404,
  // not a 500 from PG's 22P02 (invalid_text_representation). Reuses the
  // UUID_RE defined for the admin endpoints above.
  if (!UUID_RE.test(teamId)) {
    return res.status(404).json(NOT_FOUND_BODY);
  }
  const orgId = req.currentUser.org_id;
  try {
    // Tenant-pinned existence check: (id, org_id) must both match.
    const { rows } = await pool.query(
      `SELECT id, name FROM teams WHERE id = $1 AND org_id = $2`,
      [teamId, orgId],
    );
    if (rows.length === 0) {
      return res.status(404).json(NOT_FOUND_BODY);
    }
    const team = rows[0];

    // For team-scope, we don't currently surface a separate "participation"
    // pair (active / total): that maps awkwardly to "team active vs team
    // total" and the team total is itself identifying for small teams. The
    // distribution is the privacy-preserving signal; Phase C UI gets per-team
    // counts via /api/admin/teams.
    const [breath, motion, heart] = await Promise.all([
      modalityDistribution(orgId, 'breath', days.value, { teamId }),
      modalityDistribution(orgId, 'motion', days.value, { teamId }),
      modalityDistribution(orgId, 'heart',  days.value, { teamId }),
    ]);
    adminAuditRead(req);
    res.json({ team: { id: team.id, name: team.name }, distributions: { breath, motion, heart } });
  } catch (err) {
    console.error('[admin/teams/:id/overview]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// -----------------------------------------------------------------------------
// Static client — in production this server also serves the built SPA, so the
// whole app deploys as a single unit. In dev the client runs under Vite, so
// this block is inert (NODE_ENV unset, and client/dist may not exist).
// -----------------------------------------------------------------------------
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // SPA fallback: any GET that is not an API route returns index.html, so
  // client-side routing works on hard refresh. /api/* keeps its JSON 404s.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// -----------------------------------------------------------------------------
// HTTP server
// -----------------------------------------------------------------------------
const server = http.createServer(app);

// Export the Express app so the HTTP integration test (Task B8.5) can
// mount it without binding a port. Only migrate + listen when this file
// is run directly, not when it's imported.
export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`[Resona] backend listening on :${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[Resona] migration failed, aborting boot:', err);
      process.exit(1);
    });
}
