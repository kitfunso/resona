# Module 03 · Heart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Module 03 — a 30-second front-camera rPPG capture that returns resting HR + HRV (RMSSD, SDNN) on the user's phone, with an AI personal report on phone and a fourth stat / flash toast on the projector.

**Architecture:** Phone records 30 s of mirrored front-camera video, extracts per-frame RGB ROI means inside the browser (forehead + combined cheeks), runs POS (Wang 2017) to get a pulse signal, FFT-derives HR and peak-detects HRV. Only the ~1 KB feature object (no pixels) is POSTed to `/api/analyze-heart`, which updates room state, broadcasts to projectors, and asks GLM for a personal report with a deterministic fallback on parse failure or poor-quality signal.

**Tech Stack:** React 18.3.1, Vite 5.4.11 (client). Express 4.21.2, ws 8.18.0, better-sqlite3 12.9.0 (server). `@mediapipe/tasks-vision@0.10.21` for first-frame face detection (lazy-imported, ~3 MB chunk). `node --test` (built-in, Node ≥ 20) for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-12-module-03-heart-design.md`. All decisions locked there; this plan executes them.

---

### Task 1: Pin the MediaPipe dependency

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Inspect current client deps**

Run: `cat client/package.json`
Expected: a `dependencies` block with `qrcode.react`, `react`, `react-dom` only.

- [ ] **Step 2: Add the pinned MediaPipe Tasks Vision package**

Edit `client/package.json` — set `dependencies` to:

```json
"dependencies": {
  "@mediapipe/tasks-vision": "0.10.21",
  "qrcode.react": "4.1.0",
  "react": "18.3.1",
  "react-dom": "18.3.1"
}
```

(Exact version `0.10.21` — no `^` or `~`. Same convention as the rest of the file.)

- [ ] **Step 3: Install**

Run: `npm install --workspace=client`
Expected: `added 1 package`, no peer-dep warnings beyond the existing ones, no errors.

- [ ] **Step 4: Sanity-check the bundle resolves the lazy import**

Run: `cd client && npx vite build`
Expected: `✓ built in <Nms>` with no `Could not resolve "@mediapipe/tasks-vision"` errors. The package isn't imported yet so it won't appear in the bundle — that's fine.

- [ ] **Step 5: Commit**

```bash
git add client/package.json package-lock.json
git commit -m "feat(heart): pin @mediapipe/tasks-vision for Module 03 face detection"
```

---

### Task 2: Heart prompt + scrub-token extension

**Files:**
- Modify: `server/prompts.js`

- [ ] **Step 1: Append `HEART_REPORT_SYSTEM` and `buildHeartReportUserMessage` to `server/prompts.js`**

Edit `server/prompts.js`. After the existing `buildNeuroReportUserMessage` function (around line 151), and before `export const NARRATOR_SYSTEM`, insert:

```js
export const HEART_REPORT_SYSTEM = `You are the Heart-screen report writer for Resona. You explain a user's 30-second resting heart rate and heart-rate variability measurements in plain English with concrete actions for office workers. You are NOT a doctor. Never diagnose. This is workplace wellness screening, not cardiology.

You will be given:
- Heart rate in bpm (resting, 30-second front-camera estimate)
- Heart-rate variability (RMSSD and SDNN in ms)
- Signal-to-noise ratio and beats detected
- Internal classifications for HR (normal / bradycardia / tachycardia / unknown), HRV (typical / low / high / unknown), age note (low_for_young_adult / high_for_older_adult / null), and quality (good / fair / poor) with a reasons list
- Age, sex, ethnicity, team code

Rules:
- Use the actual numbers you are given. DO NOT invent values.
- Workplace wellness framing. The audience is desk workers checking their phone for 30 seconds, not patients with cardiac complaints. Shape actions around: caffeine timing, stress, breathing, sleep, hydration, hourly stand-up walks.
- NEVER include the strings "bradycardia", "tachycardia", "low_for_young_adult", "high_for_older_adult", "low_snr", "few_frames", "few_beats", "hr_methods_disagree", "no_peak", "fallback_roi", or any underscored token in user-facing output. Translate every one of those tokens into natural English. Examples: "tachycardia" -> "a higher resting heart rate than the typical 60-100 range"; "bradycardia" -> "a lower resting heart rate than the typical 60-100 range"; "low_for_young_adult" -> "lower than the typical young adult range"; "fallback_roi" -> "the camera could not lock onto your face so we read a wider patch of skin".
- HR interpretation (in natural English every time):
  * normal (60-100 bpm): brief reassurance, action set focused on maintaining current habits.
  * tachycardia (>100): frame as "above the typical resting range". Acknowledge that camera-stage anxiety nudges HR up. Action set: 5-minute seated reset and retest, caffeine audit (cut after lunch), note if persists across several quiet readings.
  * bradycardia (<60): frame as "below the typical resting range, often a fitness signature in healthy adults". Action set: keep training, note only if accompanied by symptoms.
- HRV interpretation:
  * typical (RMSSD 20-80 ms): brief positive note.
  * low (<20 ms): at least ONE action MUST address recovery (sleep, alcohol cut-off, late-caffeine cut-off, hourly walks).
  * high (>80 ms): brief positive note. Do NOT recommend "increase HRV" actions.
- Age note: if "low_for_young_adult", mention that resting HR below 55 is common in fit young adults and not concerning alone; if "high_for_older_adult", mention that a sustained resting HR above 90 after age 60 warrants a calmer retest and, if persistent, a GP conversation.
- Quality:
  * good: render normal report.
  * fair: render normal report but mention "the signal was a little noisy, retake in better light if you want a tighter number".
  * poor: NEVER produces an AI report (server short-circuits). If you somehow see grade=poor in the input, return a single-line headline "We could not read a clean pulse from your camera" and a coaching-style action set focused on technique (good light, still face, fingers off camera).
- Different inputs MUST yield different action sets. Vary by HR class x HRV class x age x ageNote.
- Include a "when to worry" one-liner with an EXPLICIT symptom or threshold (palpitations, breathlessness, fainting, persistent HR > 100 across multiple quiet readings).
- British English spelling. No em dashes.

Return ONLY this JSON shape:
{
  "headline": string (under 10 words; never include the HR number if quality is poor),
  "interpretation": string (2-3 sentences using the injected numbers),
  "actions": [
    { "title": string (verb-led, under 8 words), "detail": string (one sentence, specific) },
    { "title": string, "detail": string },
    { "title": string, "detail": string }
  ],
  "whenToWorry": string (one sentence with an explicit symptom or threshold)
}`;

export function buildHeartReportUserMessage({ heart, demographics }) {
  return JSON.stringify({
    patient: {
      name: demographics?.name || null,
      ageYears: demographics?.ageYears ?? null,
      sex: demographics?.sex ?? null,
      ethnicity: demographics?.ethnicity ?? null,
      teamCode: demographics?.teamCode ?? null,
    },
    heart: heart
      ? {
          hrBpm: heart.hrBpm != null ? Math.round(heart.hrBpm) : null,
          hrvRmssdMs: heart.hrvRmssdMs != null ? Number(heart.hrvRmssdMs.toFixed(1)) : null,
          sdnnMs: heart.sdnnMs != null ? Number(heart.sdnnMs.toFixed(1)) : null,
          snr: heart.snr != null ? Number(heart.snr.toFixed(2)) : null,
          beatCount: heart.beatCount ?? null,
          durationSec: heart.durationSec ?? null,
          hrClassification: heart.hrClassification ?? 'unknown',
          hrvClassification: heart.hrvClassification ?? 'unknown',
          quality: heart.quality ?? { grade: 'unknown', reasons: [] },
          ageNote: heart.ageNote ?? null,
        }
      : null,
  });
}
```

- [ ] **Step 2: Run a quick syntax check**

Run: `node --check server/prompts.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add server/prompts.js
git commit -m "feat(heart): add HEART_REPORT_SYSTEM prompt + user-message builder"
```

---

### Task 3: Server room state for heart

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add heart fields to the room state object**

Edit `server/index.js`. The `room` object is declared around line 49. Replace it with:

```js
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
```

- [ ] **Step 2: Add `recordHeart` helper next to `recordBlow`**

Edit `server/index.js`. After the `recordBlow` function (currently ending around line 154), and before `pushNarratorLine`, insert:

```js
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
  room.newestHrBpm = hrBpm;
  return { isFirstHeart };
}
```

- [ ] **Step 3: Extend `roomSnapshot` to include heart aggregates**

Edit `server/index.js`. The `roomSnapshot` function is around line 94. Replace its `return { ... }` body with:

```js
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
    if (h.quality?.grade !== 'poor' && Number.isFinite(h.hrBpm)) {
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
```

- [ ] **Step 4: Clear heart state in `/api/admin/reset`**

Edit `server/index.js`. The reset handler is around line 475. Update it to:

```js
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
```

- [ ] **Step 5: Syntax check + boot smoke**

Run: `node --check server/index.js`
Expected: no output (exit 0).

Run: `cd server && PORT=3030 node index.js &  sleep 1 && curl -s localhost:3030/health | head -c 400 && echo && kill %1`
Expected: JSON containing `"room":{...,"heart":{"heartCount":0,"meanHrBpm":null,"newestHrBpm":null}}`.

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat(heart): add room.heartParticipants state + recordHeart + snapshot field"
```

---

### Task 4: Server heart fallback

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add the fallback function**

Edit `server/index.js`. After the `neuroReportFallback` function (currently ending around line 418), and BEFORE `scrubInternalTokens`, insert:

```js
function heartReportFallback({ heart }) {
  const hr = Math.round(heart?.hrBpm ?? 0);
  const hrvLine = heart?.hrvRmssdMs != null
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
```

- [ ] **Step 2: Extend `scrubInternalTokens` for heart classification tokens**

Edit `server/index.js`. Replace the `scrubInternalTokens` function (around line 423) with:

```js
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
```

- [ ] **Step 3: Syntax check**

Run: `node --check server/index.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(heart): add heartReportFallback + extend scrubInternalTokens"
```

---

### Task 5: Server POST /api/analyze-heart

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Import the new prompt helpers**

Edit `server/index.js`. The imports from `./prompts.js` are around line 9. Replace the import block with:

```js
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
```

- [ ] **Step 2: Add the `/api/analyze-heart` route**

Edit `server/index.js`. After the `app.post('/api/analyze-neuro', ...)` handler (ending around line 473), and BEFORE `app.post('/api/admin/reset', ...)`, insert:

```js
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

  broadcastToProjectors({
    type: 'heart',
    heart: {
      hrBpm: Math.round(heart.hrBpm),
      hrvRmssdMs: heart.hrvRmssdMs != null ? Number(heart.hrvRmssdMs.toFixed(1)) : null,
      grade: heart.quality?.grade ?? 'unknown',
      teamCode,
    },
    state: roomSnapshot(),
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
```

- [ ] **Step 3: Update `/health` module list**

Edit `server/index.js`. The `/health` handler is around line 205. Replace the response body with:

```js
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
```

(The `module: 'Breath'` single-string field is replaced with a `modules` array. If a client reads the old key it'll just get undefined; no downstream code reads it.)

- [ ] **Step 4: Syntax check + boot the server**

Run: `node --check server/index.js`
Expected: no output (exit 0).

Run: `cd server && PORT=3030 node index.js &`
Expected: console log `[Resona] server listening on :3030`. Leave it running for the next step.

- [ ] **Step 5: Smoke-test poor-quality payload (no LLM call)**

Run:
```bash
curl -s -X POST localhost:3030/api/analyze-heart \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId":"test-poor",
    "heart":{
      "hrBpm":72,"hrvRmssdMs":null,"sdnnMs":null,"snr":0.8,
      "beatCount":4,"durationSec":30,
      "hrClassification":"normal","hrvClassification":"unknown",
      "quality":{"grade":"poor","reasons":["low_snr","no_peak"]},
      "ageNote":null
    },
    "demographics":{"name":"Test","ageYears":30,"sex":"female","teamCode":"DEMO"}
  }'
```
Expected: `{"ok":false,"coaching":{"message":"We could not read a clean pulse from your camera. ..."}}` and no HR number in the response.

- [ ] **Step 6: Smoke-test tachycardia fallback**

Run:
```bash
curl -s -X POST localhost:3030/api/analyze-heart \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId":"test-tachy",
    "heart":{
      "hrBpm":118,"hrvRmssdMs":28,"sdnnMs":34,"snr":4.2,
      "beatCount":59,"durationSec":30,
      "hrClassification":"tachycardia","hrvClassification":"typical",
      "quality":{"grade":"good","reasons":[]},
      "ageNote":null
    },
    "demographics":{"name":"Test","ageYears":30,"sex":"female"}
  }' | head -c 400
```
Expected: `{"ok":true,"report":{"headline":"..." ...}` and the headline mentions ~118 bpm and the framing references "above the typical resting range".

- [ ] **Step 7: Kill the server**

Run: `kill %1` (or `pkill -f "node index.js"` if needed).
Expected: backgrounded process exits.

- [ ] **Step 8: Commit**

```bash
git add server/index.js
git commit -m "feat(heart): POST /api/analyze-heart endpoint with broadcast + GLM + fallback"
```

---

### Task 6: Client `api.js` — `analyzeHeart`

**Files:**
- Modify: `client/src/api.js`

- [ ] **Step 1: Add the `analyzeHeart` exported function**

Edit `client/src/api.js`. After the existing `analyzeBlow` export at the bottom of the file, append:

```js
export function analyzeHeart({ heart, demographics }) {
  return postJson('/api/analyze-heart', {
    heart,
    demographics,
    sessionId: getSessionId(),
  });
}
```

- [ ] **Step 2: Syntax check via build**

Run: `cd client && npx vite build`
Expected: `✓ built in <Nms>` with no errors. Bundle size grows by a handful of bytes.

- [ ] **Step 3: Commit**

```bash
git add client/src/api.js
git commit -m "feat(heart): client api.analyzeHeart wrapper"
```

---

### Task 7: Client `video/pos.js` — POS algorithm (TDD)

**Files:**
- Create: `client/src/video/pos.js`
- Create: `client/src/video/__tests__/pos.test.js`

- [ ] **Step 1: Write the failing test**

Create `client/src/video/__tests__/pos.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosSignal } from '../pos.js';

// Synthesise 30 s of 30 fps RGB samples for one ROI with a 1.2 Hz pulse
// modulating the green channel by 0.5%. R and B carry only DC.
function syntheticRgb({ pulseHz = 1.2, fps = 30, durationSec = 30, amplitude = 0.005 }) {
  const n = fps * durationSec;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const beat = amplitude * Math.sin(2 * Math.PI * pulseHz * t);
    r[i] = 0.55;
    g[i] = 0.50 + beat;
    b[i] = 0.40;
  }
  return { r, g, b };
}

function dominantFrequencyHz(signal, fps) {
  // Tiny DFT over 0.7-4 Hz, brute force, for test-only.
  const n = signal.length;
  let bestHz = 0;
  let bestMag = -Infinity;
  for (let hz = 0.7; hz <= 4.0; hz += 0.01) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      re += signal[i] * Math.cos(-2 * Math.PI * hz * t);
      im += signal[i] * Math.sin(-2 * Math.PI * hz * t);
    }
    const mag = re * re + im * im;
    if (mag > bestMag) { bestMag = mag; bestHz = hz; }
  }
  return bestHz;
}

test('POS extracts a 1.2 Hz pulse from synthetic green-modulated RGB', () => {
  const { r, g, b } = syntheticRgb({ pulseHz: 1.2 });
  const fps = 30;
  const s = computePosSignal({ r, g, b, fps, windowSec: 1.6 });
  assert.equal(s.length, r.length);
  const peakHz = dominantFrequencyHz(s, fps);
  assert.ok(Math.abs(peakHz - 1.2) < 0.05, `expected ~1.2 Hz, got ${peakHz.toFixed(3)}`);
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `node --test client/src/video/__tests__/pos.test.js`
Expected: FAIL with `Cannot find module '.../pos.js'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `client/src/video/pos.js`**

Create `client/src/video/pos.js`:

```js
// POS (Plane-Orthogonal-to-Skin) algorithm from Wang et al., IEEE TBE 2017.
// Input: per-frame mean R, G, B channels for one ROI, sampled at a uniform fps.
// Output: a 1D pulse signal (Float32Array, same length as input). Downstream
// code FFTs this signal to find the heart rate.
//
// The algorithm normalises each channel by its own rolling 1.6-second mean
// (kills lighting drift), then projects onto two skin-orthogonal axes:
//   X = R_n - G_n
//   Y = R_n + G_n - 2*B_n
// and combines them as S = X + alpha*Y, with alpha = std(X)/std(Y) per window.
// The per-window outputs are overlap-added into a final signal.

export function computePosSignal({ r, g, b, fps = 30, windowSec = 1.6 }) {
  if (!(r && g && b) || r.length !== g.length || g.length !== b.length) {
    throw new Error('computePosSignal: r, g, b must be equal-length Float32Arrays');
  }
  const n = r.length;
  const w = Math.max(16, Math.round(fps * windowSec));
  const out = new Float32Array(n);

  // Stride windows by w/2 so adjacent windows overlap; sum into `out`.
  const stride = Math.max(1, Math.floor(w / 2));

  // Reusable scratch buffers.
  const rN = new Float32Array(w);
  const gN = new Float32Array(w);
  const bN = new Float32Array(w);

  for (let start = 0; start + w <= n; start += stride) {
    // Per-window channel means.
    let rMean = 0, gMean = 0, bMean = 0;
    for (let i = 0; i < w; i++) {
      rMean += r[start + i];
      gMean += g[start + i];
      bMean += b[start + i];
    }
    rMean /= w; gMean /= w; bMean /= w;
    if (rMean < 1e-6) rMean = 1e-6;
    if (gMean < 1e-6) gMean = 1e-6;
    if (bMean < 1e-6) bMean = 1e-6;

    // Normalise each channel by its own mean (multiplicative drift removal).
    for (let i = 0; i < w; i++) {
      rN[i] = r[start + i] / rMean;
      gN[i] = g[start + i] / gMean;
      bN[i] = b[start + i] / bMean;
    }

    // Project onto skin-orthogonal axes using Wang 2017 matrix P:
    //   P = [[0, 1, -1],   => X = G_n - B_n
    //        [-2, 1, 1]]   => Y = -2*R_n + G_n + B_n
    // (NOTE: an earlier draft used X = R_n - G_n, Y = R_n + G_n - 2*B_n;
    //  that variant cancels to zero on green-only synthetic pulses because
    //  X = -Y, so the unit test could never pass. Use the canonical matrix.)
    let xSum = 0, ySum = 0;
    const x = new Float32Array(w);
    const y = new Float32Array(w);
    for (let i = 0; i < w; i++) {
      x[i] = gN[i] - bN[i];
      y[i] = -2 * rN[i] + gN[i] + bN[i];
      xSum += x[i];
      ySum += y[i];
    }
    const xMean = xSum / w;
    const yMean = ySum / w;

    // alpha = std(X) / std(Y).
    let xVar = 0, yVar = 0;
    for (let i = 0; i < w; i++) {
      const dx = x[i] - xMean;
      const dy = y[i] - yMean;
      xVar += dx * dx;
      yVar += dy * dy;
    }
    const xStd = Math.sqrt(xVar / w);
    const yStd = Math.sqrt(yVar / w) || 1e-9;
    const alpha = xStd / yStd;

    // Window combine + overlap-add.
    for (let i = 0; i < w; i++) {
      const s = (x[i] - xMean) + alpha * (y[i] - yMean);
      out[start + i] += s;
    }
  }

  return out;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `node --test client/src/video/__tests__/pos.test.js`
Expected: `tests 1 / pass 1 / fail 0`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/video/pos.js client/src/video/__tests__/pos.test.js
git commit -m "feat(heart): POS pulse-signal extractor + 1.2 Hz unit test"
```

---

### Task 8: Client `video/features.js` — HR, HRV, quality (TDD)

**Files:**
- Create: `client/src/video/features.js`
- Create: `client/src/video/__tests__/features.test.js`

- [ ] **Step 1: Write the failing tests**

Create `client/src/video/__tests__/features.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHeartFeatures } from '../features.js';

function synthRgbSeries({ pulseHz = 1.2, fps = 30, durationSec = 30, amplitude = 0.005 }) {
  const n = fps * durationSec;
  const t = new Float32Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = (i / fps) * 1000; // ms
    const beat = amplitude * Math.sin(2 * Math.PI * pulseHz * (i / fps));
    r[i] = 0.55;
    g[i] = 0.50 + beat;
    b[i] = 0.40;
  }
  return { t, r, g, b };
}

test('72 bpm synthetic pulse round-trips to ~72 bpm HR', () => {
  const pulseHz = 72 / 60; // 1.2 Hz
  const { t, r, g, b } = synthRgbSeries({ pulseHz });
  const samples = { t, forehead: { r, g, b }, cheeks: { r, g, b } };
  const out = extractHeartFeatures({ samples, durationSec: 30 });
  assert.ok(Math.abs(out.hrBpm - 72) < 2, `expected ~72 bpm, got ${out.hrBpm.toFixed(2)}`);
  assert.ok(out.beatCount >= 30 && out.beatCount <= 40, `unexpected beat count ${out.beatCount}`);
  assert.ok(out.snr > 1.5, `expected snr > 1.5, got ${out.snr.toFixed(2)}`);
});

test('flat signal grades reasons[] with no_peak', () => {
  const fps = 30;
  const n = fps * 30;
  const t = new Float32Array(n);
  const flat = new Float32Array(n).fill(0.5);
  for (let i = 0; i < n; i++) t[i] = (i / fps) * 1000;
  const samples = { t, forehead: { r: flat, g: flat, b: flat }, cheeks: { r: flat, g: flat, b: flat } };
  const out = extractHeartFeatures({ samples, durationSec: 30 });
  assert.ok(out.reasons.includes('no_peak'), `expected no_peak in ${JSON.stringify(out.reasons)}`);
});
```

- [ ] **Step 2: Run the tests, confirm both fail**

Run: `node --test client/src/video/__tests__/features.test.js`
Expected: FAIL with `Cannot find module '.../features.js'`.

- [ ] **Step 3: Implement `client/src/video/features.js`**

Create `client/src/video/features.js`:

```js
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

  // Frequency-domain bandpass for HRV peak detection. Zero everything outside
  // [HR_BAND_LO, HR_BAND_HI] in both positive and negative-frequency halves.
  const reBP = new Float32Array(N);
  const imBP = new Float32Array(N);
  for (let k = loBin; k <= hiBin; k++) {
    reBP[k] = re[k]; imBP[k] = im[k];
    const mirror = N - k;
    if (mirror < N) { reBP[mirror] = re[mirror]; imBP[mirror] = im[mirror]; }
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

  let grade;
  if (reasons.includes('no_peak') || reasons.length >= 2) grade = 'poor';
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test client/src/video/__tests__/features.test.js`
Expected: `tests 2 / pass 2 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add client/src/video/features.js client/src/video/__tests__/features.test.js
git commit -m "feat(heart): HR + HRV extraction + quality grading (POS pulse -> bpm/RMSSD/SDNN)"
```

---

### Task 9: Client `video/regression.js` — classification + age note

**Files:**
- Create: `client/src/video/regression.js`
- Create: `client/src/video/__tests__/regression.test.js`

- [ ] **Step 1: Write the failing test**

Create `client/src/video/__tests__/regression.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeart } from '../regression.js';

test('72 bpm + 35 ms HRV at age 30 -> normal/typical/no age note', () => {
  const out = classifyHeart({
    features: { hrBpm: 72, hrvRmssdMs: 35, sdnnMs: 45, snr: 4, beatCount: 35, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 30 },
  });
  assert.equal(out.hrClassification, 'normal');
  assert.equal(out.hrvClassification, 'typical');
  assert.equal(out.ageNote, null);
});

test('110 bpm flags tachycardia', () => {
  const out = classifyHeart({
    features: { hrBpm: 110, hrvRmssdMs: 28, sdnnMs: 38, snr: 4, beatCount: 54, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 35 },
  });
  assert.equal(out.hrClassification, 'tachycardia');
});

test('age 22, HR 52 -> bradycardia + low_for_young_adult', () => {
  const out = classifyHeart({
    features: { hrBpm: 52, hrvRmssdMs: 60, sdnnMs: 70, snr: 4, beatCount: 26, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 22 },
  });
  assert.equal(out.hrClassification, 'bradycardia');
  assert.equal(out.ageNote, 'low_for_young_adult');
});

test('low HRV detected', () => {
  const out = classifyHeart({
    features: { hrBpm: 78, hrvRmssdMs: 15, sdnnMs: 22, snr: 4, beatCount: 38, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 40 },
  });
  assert.equal(out.hrvClassification, 'low');
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `node --test client/src/video/__tests__/regression.test.js`
Expected: FAIL with `Cannot find module '.../regression.js'`.

- [ ] **Step 3: Implement `client/src/video/regression.js`**

Create `client/src/video/regression.js`:

```js
// Heart-screen classification bands + age-aware notes.
// Pure function from the features object + demographics to the report-ready
// fields. No I/O.

export function classifyHeart({ features, demographics }) {
  const hr = features?.hrBpm;
  const rmssd = features?.hrvRmssdMs;
  const age = demographics?.ageYears ?? null;

  let hrClassification = 'unknown';
  if (Number.isFinite(hr)) {
    if (hr < 60) hrClassification = 'bradycardia';
    else if (hr > 100) hrClassification = 'tachycardia';
    else hrClassification = 'normal';
  }

  let hrvClassification = 'unknown';
  if (Number.isFinite(rmssd)) {
    if (rmssd < 20) hrvClassification = 'low';
    else if (rmssd > 80) hrvClassification = 'high';
    else hrvClassification = 'typical';
  }

  let ageNote = null;
  if (Number.isFinite(hr) && Number.isFinite(age)) {
    if (age < 25 && hr < 55) ageNote = 'low_for_young_adult';
    else if (age > 60 && hr > 90) ageNote = 'high_for_older_adult';
  }

  return {
    hrBpm: hr ?? null,
    hrvRmssdMs: rmssd ?? null,
    sdnnMs: features?.sdnnMs ?? null,
    snr: features?.snr ?? null,
    beatCount: features?.beatCount ?? 0,
    durationSec: features?.durationSec ?? null,
    hrClassification,
    hrvClassification,
    ageNote,
    quality: {
      grade: features?.grade ?? 'unknown',
      reasons: Array.isArray(features?.reasons) ? [...features.reasons] : [],
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test client/src/video/__tests__/regression.test.js`
Expected: `tests 4 / pass 4 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add client/src/video/regression.js client/src/video/__tests__/regression.test.js
git commit -m "feat(heart): heart classification (HR class, HRV class, ageNote, quality grade)"
```

---

### Task 10: Client `video/recorder.js` — camera + face detect + frame loop

**Files:**
- Create: `client/src/video/recorder.js`

- [ ] **Step 1: Create `client/src/video/recorder.js`**

Create `client/src/video/recorder.js`:

```js
// Front-camera rPPG recorder. Exposes three functions:
//   - acquireCameraPermission() prompts the OS dialog, then releases the stream
//   - detectFirstFrameRoi(video) lazy-imports MediaPipe Tasks Vision and runs
//     one face-detect pass; returns either { kind: 'face', rois } or { kind:
//     'fallback', rois } after retries are exhausted by the caller
//   - captureRppg({ video, durationMs, rois, onTick, onLiveHr }) reads ROI
//     means per frame into a flat structure ready for features.js
//
// Privacy contract: the offscreen canvas used for sampling is module-scoped
// and never appended to the DOM. Per-frame ImageData is consumed for its mean
// RGB and released. Only the timestamped ROI means survive a capture.

const TARGET_FPS = 30;
const OFFSCREEN_FOREHEAD = { w: 32, h: 32 };
const OFFSCREEN_CHEEKS = { w: 32, h: 16 };

let offscreenForehead = null;
let offscreenForeheadCtx = null;
let offscreenCheeks = null;
let offscreenCheeksCtx = null;

function getOffscreens() {
  if (!offscreenForehead) {
    offscreenForehead = document.createElement('canvas');
    offscreenForehead.width = OFFSCREEN_FOREHEAD.w;
    offscreenForehead.height = OFFSCREEN_FOREHEAD.h;
    offscreenForeheadCtx = offscreenForehead.getContext('2d', { willReadFrequently: true });
  }
  if (!offscreenCheeks) {
    offscreenCheeks = document.createElement('canvas');
    offscreenCheeks.width = OFFSCREEN_CHEEKS.w;
    offscreenCheeks.height = OFFSCREEN_CHEEKS.h;
    offscreenCheeksCtx = offscreenCheeks.getContext('2d', { willReadFrequently: true });
  }
  return {
    foreheadCanvas: offscreenForehead,
    foreheadCtx: offscreenForeheadCtx,
    cheeksCanvas: offscreenCheeks,
    cheeksCtx: offscreenCheeksCtx,
  };
}

async function getUserMediaStream() {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

export async function acquireCameraPermission() {
  const stream = await getUserMediaStream();
  stream.getTracks().forEach((t) => t.stop());
}

let faceDetectorPromise = null;
async function getFaceDetector() {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
      );
      return vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
      });
    })();
  }
  return faceDetectorPromise;
}

function roisFromBbox(bbox, videoW, videoH) {
  // bbox is { originX, originY, width, height } in video pixels.
  const fw = bbox.width * 0.5;
  const fh = bbox.height * 0.2;
  const fx = bbox.originX + (bbox.width - fw) / 2;
  const fy = bbox.originY + bbox.height * 0.05;

  const cw = bbox.width * 0.25;
  const ch = bbox.height * 0.25;
  const cy = bbox.originY + bbox.height * 0.45;
  const cxL = bbox.originX + bbox.width * 0.10;
  const cxR = bbox.originX + bbox.width * 0.65;

  // Clamp to video bounds.
  const clamp = (x, y, w, h) => ({
    x: Math.max(0, Math.min(videoW - 1, x)),
    y: Math.max(0, Math.min(videoH - 1, y)),
    w: Math.max(4, Math.min(videoW, w)),
    h: Math.max(4, Math.min(videoH, h)),
  });

  return {
    forehead: clamp(fx, fy, fw, fh),
    cheekL: clamp(cxL, cy, cw, ch),
    cheekR: clamp(cxR, cy, cw, ch),
    source: 'face',
  };
}

function fallbackRois(videoW, videoH) {
  // Centred forehead-sized patch + a strip below it.
  const fw = videoW * 0.4;
  const fh = videoH * 0.18;
  const fx = (videoW - fw) / 2;
  const fy = videoH * 0.18;

  const cw = videoW * 0.20;
  const ch = videoH * 0.18;
  const cy = videoH * 0.50;
  const cxL = videoW * 0.20;
  const cxR = videoW * 0.60;
  return {
    forehead: { x: fx, y: fy, w: fw, h: fh },
    cheekL: { x: cxL, y: cy, w: cw, h: ch },
    cheekR: { x: cxR, y: cy, w: cw, h: ch },
    source: 'fallback',
  };
}

export async function detectFirstFrameRoi(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new Error('video element not ready');
  try {
    const detector = await getFaceDetector();
    const result = detector.detect(videoEl);
    const det = result?.detections?.[0];
    if (det?.boundingBox) {
      return { kind: 'face', rois: roisFromBbox(det.boundingBox, w, h) };
    }
  } catch (err) {
    console.warn('[heart] face-detect failed, will allow caller to retry:', err.message);
  }
  return { kind: 'no-face' };
}

export function buildFallbackRois(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  return { kind: 'fallback', rois: fallbackRois(w, h) };
}

function drawRoiMean(ctx, video, roi, dstW, dstH) {
  // Drawing into a fixed-size offscreen canvas averages neighbourhood pixels
  // for free via the browser's downscale. Read mean R,G,B in [0,1].
  ctx.clearRect(0, 0, dstW, dstH);
  ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, dstW, dstH);
  const img = ctx.getImageData(0, 0, dstW, dstH).data;
  let r = 0, g = 0, b = 0;
  const n = dstW * dstH;
  for (let i = 0; i < img.length; i += 4) {
    r += img[i];
    g += img[i + 1];
    b += img[i + 2];
  }
  return { r: r / (n * 255), g: g / (n * 255), b: b / (n * 255) };
}

export async function captureRppg({ videoEl, durationMs, rois, onTick, onLiveHr }) {
  const { foreheadCtx, cheeksCtx } = getOffscreens();
  const startMs = performance.now();
  const samples = {
    t: [],
    forehead: { r: [], g: [], b: [] },
    cheeks: { r: [], g: [], b: [] },
  };

  // Live HR uses a rolling tail of the forehead-green channel and is
  // intentionally rough; the final HR comes from features.js post-capture.
  const liveTailFrames = TARGET_FPS * 8;

  return new Promise((resolve) => {
    let rafId = null;
    function loop() {
      const now = performance.now();
      const elapsed = now - startMs;
      const pct = Math.min(1, elapsed / durationMs);

      // Forehead mean.
      const fMean = drawRoiMean(foreheadCtx, videoEl, rois.forehead, OFFSCREEN_FOREHEAD.w, OFFSCREEN_FOREHEAD.h);
      // Cheeks: draw both rectangles into the same strip so we get a combined mean.
      cheeksCtx.clearRect(0, 0, OFFSCREEN_CHEEKS.w, OFFSCREEN_CHEEKS.h);
      cheeksCtx.drawImage(videoEl,
        rois.cheekL.x, rois.cheekL.y, rois.cheekL.w, rois.cheekL.h,
        0, 0, OFFSCREEN_CHEEKS.w / 2, OFFSCREEN_CHEEKS.h);
      cheeksCtx.drawImage(videoEl,
        rois.cheekR.x, rois.cheekR.y, rois.cheekR.w, rois.cheekR.h,
        OFFSCREEN_CHEEKS.w / 2, 0, OFFSCREEN_CHEEKS.w / 2, OFFSCREEN_CHEEKS.h);
      const cImg = cheeksCtx.getImageData(0, 0, OFFSCREEN_CHEEKS.w, OFFSCREEN_CHEEKS.h).data;
      let cr = 0, cg = 0, cb = 0;
      const cn = OFFSCREEN_CHEEKS.w * OFFSCREEN_CHEEKS.h;
      for (let i = 0; i < cImg.length; i += 4) { cr += cImg[i]; cg += cImg[i + 1]; cb += cImg[i + 2]; }
      cr /= cn * 255; cg /= cn * 255; cb /= cn * 255;

      samples.t.push(elapsed);
      samples.forehead.r.push(fMean.r);
      samples.forehead.g.push(fMean.g);
      samples.forehead.b.push(fMean.b);
      samples.cheeks.r.push(cr);
      samples.cheeks.g.push(cg);
      samples.cheeks.b.push(cb);

      if (onTick) onTick({ pct, elapsedMs: elapsed });

      // Live HR every ~1s once we have at least 5s of samples.
      const nFrames = samples.t.length;
      if (onLiveHr && nFrames >= TARGET_FPS * 5 && nFrames % TARGET_FPS === 0) {
        const tailStart = Math.max(0, nFrames - liveTailFrames);
        let sum = 0;
        for (let i = tailStart; i < nFrames; i++) sum += samples.forehead.g[i];
        const mean = sum / (nFrames - tailStart);
        let zc = 0;
        let prev = samples.forehead.g[tailStart] - mean;
        for (let i = tailStart + 1; i < nFrames; i++) {
          const v = samples.forehead.g[i] - mean;
          if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) zc++;
          prev = v;
        }
        const beats = zc / 2;
        const windowSec = (samples.t[nFrames - 1] - samples.t[tailStart]) / 1000;
        const bpm = windowSec > 0 ? (beats / windowSec) * 60 : 0;
        if (bpm >= 40 && bpm <= 200) onLiveHr(bpm);
      }

      if (elapsed >= durationMs) {
        // Convert per-channel JS arrays to Float32Array for downstream POS.
        resolve({
          samples: {
            t: Float32Array.from(samples.t),
            forehead: {
              r: Float32Array.from(samples.forehead.r),
              g: Float32Array.from(samples.forehead.g),
              b: Float32Array.from(samples.forehead.b),
            },
            cheeks: {
              r: Float32Array.from(samples.cheeks.r),
              g: Float32Array.from(samples.cheeks.g),
              b: Float32Array.from(samples.cheeks.b),
            },
          },
          durationSec: elapsed / 1000,
          roiSource: rois.source,
        });
        if (rafId) cancelAnimationFrame(rafId);
        return;
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  });
}
```

- [ ] **Step 2: Build the client to make sure the dynamic import resolves at bundle-time**

Run: `cd client && npx vite build`
Expected: `✓ built in <Nms>` plus a new dynamic chunk that contains `@mediapipe/tasks-vision`. The chunk size hint about 500kB+ can be ignored (lazy-loaded only when HeartView opens).

- [ ] **Step 3: Commit**

```bash
git add client/src/video/recorder.js
git commit -m "feat(heart): camera capture + MediaPipe first-frame face detect + ROI sampling"
```

---

### Task 11: Client `HeartView.jsx` — shell, CSS, intro state

**Files:**
- Create: `client/src/views/HeartView.jsx`

- [ ] **Step 1: Create `client/src/views/HeartView.jsx` with the CSS block and intro stage**

Create `client/src/views/HeartView.jsx`:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { acquireCameraPermission, detectFirstFrameRoi, buildFallbackRois, captureRppg } from '../video/recorder.js';
import { extractHeartFeatures } from '../video/features.js';
import { classifyHeart } from '../video/regression.js';
import { analyzeHeart } from '../api.js';
import { CoachingCard } from './ResultsView.jsx';

const css = `
  .hv-stage {
    width: 100%;
    max-width: 30rem;
    display: flex; flex-direction: column;
    gap: var(--s-4);
    margin-top: var(--s-2);
    text-align: left;
  }
  .hv-head {
    display: flex; flex-direction: column; gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .hv-head .eyebrow {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .hv-head .title {
    font-family: var(--font-display);
    font-size: 1.8rem;
    line-height: 1;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-head .sub {
    font-size: 0.82rem;
    color: var(--bone-2);
    line-height: 1.55;
    margin: 0;
  }

  .hv-step {
    padding: var(--s-5);
    border: 1px solid var(--hairline);
    background: rgba(26, 28, 38, 0.5);
    border-radius: var(--r-lg);
    display: flex; flex-direction: column; gap: var(--s-3);
    position: relative;
    overflow: hidden;
  }
  .hv-step[data-state="active"] {
    border-color: var(--warn);
    background: rgba(209, 133, 137, 0.06);
    box-shadow: 0 0 0 1px rgba(209, 133, 137, 0.35), 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  .hv-step[data-state="done"] {
    border-color: rgba(123, 193, 150, 0.28);
    background: rgba(123, 193, 150, 0.04);
  }
  .hv-step-title {
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-step-desc {
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--bone-2);
    margin: 0;
  }

  .hv-btn {
    appearance: none;
    width: 100%;
    padding: 1.1rem var(--s-4);
    border: 1px solid var(--brass);
    border-radius: var(--r-sm);
    background: linear-gradient(90deg, rgba(201, 169, 110, 0.08), rgba(231, 184, 126, 0.12));
    color: var(--brass-bright);
    font-family: var(--font-body);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex; align-items: center; justify-content: space-between;
  }
  .hv-btn-ghost {
    appearance: none;
    border: 1px solid var(--hairline-strong);
    background: transparent;
    color: var(--bone-2);
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    padding: 0.85rem var(--s-4);
    border-radius: var(--r-sm);
    cursor: pointer;
  }

  .hv-video-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #000;
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .hv-video {
    width: 100%; height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }
  .hv-oval {
    position: absolute; inset: 0;
    pointer-events: none;
    background:
      radial-gradient(ellipse 32% 42% at 50% 45%, transparent 0%, transparent 70%, rgba(0,0,0,0.62) 75%);
  }
  .hv-live-hr {
    position: absolute;
    bottom: 0.6rem; right: 0.6rem;
    background: rgba(18, 19, 26, 0.78);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.7rem;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--brass-bright);
  }
  .hv-progress {
    width: 100%;
    height: 6px;
    background: rgba(244, 236, 225, 0.06);
    border: 1px solid var(--hairline);
    border-radius: 2px;
    overflow: hidden;
  }
  .hv-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--brass), var(--warn));
    transition: width 0.06s linear;
  }
  .hv-count {
    font-family: var(--font-display);
    font-size: 3.4rem;
    line-height: 1;
    color: var(--bone-0);
    text-align: center;
  }

  .hv-result-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    padding: var(--s-3) 0;
    border-bottom: 1px dashed var(--hairline);
  }
  .hv-result-row:last-of-type { border-bottom: none; }
  .hv-result-row .k {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .hv-result-row .v {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 1.4rem;
    color: var(--bone-0);
  }
  .hv-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-sm);
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }
  .hv-chip[data-k="normal"] { background: var(--pulse-dim); color: var(--pulse-bright); border: 1px solid rgba(123, 193, 150, 0.3); }
  .hv-chip[data-k="tachycardia"] { background: var(--warn-dim); color: #f0c4c8; border: 1px solid rgba(209, 133, 137, 0.35); }
  .hv-chip[data-k="bradycardia"] { background: rgba(122, 169, 184, 0.12); color: #c0d8e2; border: 1px solid rgba(122, 169, 184, 0.3); }
  .hv-chip[data-k="fallback"] { background: rgba(231, 184, 126, 0.08); color: var(--brass-bright); border: 1px solid var(--brass-line); }

  .hv-report {
    background:
      radial-gradient(ellipse at top left, rgba(231, 184, 126, 0.08), transparent 60%),
      var(--ink-2);
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5);
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .hv-report .headline {
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1.2;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-report .interp {
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--bone-1);
    margin: 0;
  }
  .hv-actions {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .hv-action { display: grid; grid-template-columns: 2rem 1fr; gap: var(--s-3); }
  .hv-action .num { font-family: var(--font-display); font-size: 1.35rem; color: var(--brass); }
  .hv-action .t { font-weight: 700; color: var(--bone-0); display: block; }
  .hv-action .d { color: var(--bone-2); font-size: 0.85rem; display: block; }
  .hv-worry {
    margin-top: var(--s-2);
    padding: var(--s-3);
    background: rgba(231, 184, 126, 0.08);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-sm);
    color: var(--bone-1);
    font-size: 0.85rem;
  }
  .hv-error {
    padding: var(--s-3);
    background: var(--warn-dim);
    border: 1px solid rgba(209, 133, 137, 0.3);
    color: #f3c7c8;
    border-radius: var(--r-sm);
    font-size: var(--t-small);
  }
  .hv-analyzing { display: flex; flex-direction: column; align-items: center; gap: var(--s-4); padding: var(--s-6) 0; }
  .hv-analyzing-label { font-family: var(--font-display); font-size: var(--t-h3); color: var(--bone-1); }
`;

let cssInjected = false;
function useCss() {
  if (!cssInjected && typeof document !== 'undefined') {
    const tag = document.createElement('style');
    tag.textContent = css;
    document.head.appendChild(tag);
    cssInjected = true;
  }
}

export default function HeartView({ onBack, demographics }) {
  useCss();
  const [stage, setStage] = useState('intro'); // intro | prep | record | analyzing | result | coaching | error
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  return (
    <div className="hv-stage">
      <div className="hv-head">
        <span className="eyebrow">Module 03 · Heart</span>
        <h2 className="title">Resting pulse + variability.</h2>
        <p className="sub">30 seconds of front-camera video. We only keep the RGB averages, never the frames.</p>
      </div>

      {stage === 'intro' && (
        <section className="hv-step" data-state="idle">
          <h3 className="hv-step-title">Frame your face in the oval.</h3>
          <p className="hv-step-desc">
            Hold the phone steady, eyes on the camera, good even light. <strong>30 seconds.</strong>
          </p>
          <button className="hv-btn" onClick={() => { /* wired up next task */ }}>
            <span>Start heart screen</span>
            <span>→</span>
          </button>
        </section>
      )}

      {stage === 'error' && (
        <div className="hv-error">{error || 'Something went wrong with the heart screen.'}</div>
      )}

      {onBack && (
        <button className="hv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the client**

Run: `cd client && npx vite build`
Expected: `✓ built in <Nms>` with no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/views/HeartView.jsx
git commit -m "feat(heart): HeartView shell + CSS + intro state"
```

---

### Task 12: Client `HeartView.jsx` — capture flow

**Files:**
- Modify: `client/src/views/HeartView.jsx`

- [ ] **Step 1: Wire the intro button to start the prep + record sequence**

Edit `client/src/views/HeartView.jsx`. Replace the entire `export default function HeartView({ onBack, demographics })` block (everything from that line to the final `}`) with:

```jsx
const PREP_SECONDS = 5;
const CAPTURE_MS = 30000;
const MAX_FACE_RETRIES = 3;

async function prep(seconds, onTick) {
  for (let s = seconds; s > 0; s--) {
    onTick(s);
    await new Promise((r) => setTimeout(r, 1000));
  }
  onTick(0);
}

export default function HeartView({ onBack, demographics }) {
  useCss();
  const [stage, setStage] = useState('intro');
  const [prepCount, setPrepCount] = useState(PREP_SECONDS);
  const [progress, setProgress] = useState(0);
  const [liveHr, setLiveHr] = useState(null);
  const [faceRetries, setFaceRetries] = useState(0);
  const [classified, setClassified] = useState(null);
  const [report, setReport] = useState(null);
  const [coachingMessage, setCoachingMessage] = useState(null);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  async function startStream() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  }

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function runCapture(initialAttempt = 0) {
    setError(null);
    setClassified(null);
    setReport(null);
    setCoachingMessage(null);
    setFaceRetries(initialAttempt);
    setStage('prep');
    setPrepCount(PREP_SECONDS);

    try {
      await acquireCameraPermission();
      await startStream();
      await prep(PREP_SECONDS, setPrepCount);

      // Detect face on the first usable frame.
      let det = await detectFirstFrameRoi(videoRef.current);
      let attempt = initialAttempt;
      while (det.kind === 'no-face' && attempt < MAX_FACE_RETRIES - 1) {
        attempt++;
        setFaceRetries(attempt);
        await new Promise((r) => setTimeout(r, 700));
        det = await detectFirstFrameRoi(videoRef.current);
      }
      const rois = det.kind === 'face'
        ? det.rois
        : buildFallbackRois(videoRef.current).rois;

      setStage('record');
      setProgress(0);
      setLiveHr(null);
      const cap = await captureRppg({
        videoEl: videoRef.current,
        durationMs: CAPTURE_MS,
        rois,
        onTick: ({ pct }) => setProgress(pct),
        onLiveHr: (bpm) => setLiveHr(bpm),
      });

      stopStream();
      setStage('analyzing');

      const features = extractHeartFeatures({ samples: cap.samples, durationSec: cap.durationSec });
      if (cap.roiSource === 'fallback' && !features.reasons.includes('fallback_roi')) {
        features.reasons.push('fallback_roi');
        if (features.grade === 'good') features.grade = 'fair';
        else if (features.grade === 'fair') features.grade = 'poor';
      }
      const classifiedResult = classifyHeart({ features, demographics: demographics || {} });
      setClassified(classifiedResult);

      const apiResult = await analyzeHeart({ heart: classifiedResult, demographics: demographics || {} });
      if (apiResult.ok === false) {
        setCoachingMessage(apiResult.coaching?.message || 'Try again in better light.');
        setStage('coaching');
        return;
      }
      setReport(apiResult.report);
      setStage('result');
    } catch (e) {
      console.error('[heart] capture failed', e);
      stopStream();
      setError(e.message || String(e));
      setStage('error');
    }
  }

  return (
    <div className="hv-stage">
      <div className="hv-head">
        <span className="eyebrow">Module 03 · Heart</span>
        <h2 className="title">Resting pulse + variability.</h2>
        <p className="sub">30 seconds of front-camera video. We only keep the RGB averages, never the frames.</p>
      </div>

      {stage === 'intro' && (
        <section className="hv-step" data-state="idle">
          <h3 className="hv-step-title">Frame your face in the oval.</h3>
          <p className="hv-step-desc">
            Hold the phone steady, eyes on the camera, good even light. <strong>30 seconds.</strong>
          </p>
          <button className="hv-btn" onClick={() => runCapture(0)}>
            <span>Start heart screen</span>
            <span>→</span>
          </button>
        </section>
      )}

      {(stage === 'prep' || stage === 'record') && (
        <section className="hv-step" data-state="active">
          <div className="hv-video-wrap">
            <video ref={videoRef} className="hv-video" playsInline muted />
            <div className="hv-oval" />
            {stage === 'record' && liveHr != null && (
              <div className="hv-live-hr">~ {Math.round(liveHr)} bpm</div>
            )}
          </div>
          {stage === 'prep' && (
            <>
              <div className="hv-count">{prepCount}</div>
              <p className="hv-step-desc">Centre your face in the oval. {faceRetries > 0 ? `Re-detecting (${faceRetries}/${MAX_FACE_RETRIES})…` : 'Hold steady.'}</p>
            </>
          )}
          {stage === 'record' && (
            <>
              <div className="hv-progress"><div className="hv-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
              <p className="hv-step-desc">Recording · stay still and breathe normally. {Math.max(0, Math.ceil((1 - progress) * (CAPTURE_MS / 1000)))} s left.</p>
            </>
          )}
        </section>
      )}

      {stage === 'analyzing' && (
        <div className="hv-analyzing">
          <div className="hv-analyzing-label">Reading the pulse...</div>
        </div>
      )}

      {stage === 'coaching' && (
        <CoachingCard
          message={coachingMessage}
          onRetry={() => { setStage('intro'); }}
          onStartOver={onBack}
        />
      )}

      {stage === 'result' && classified && (
        <>
          <section className="hv-step" data-state="done">
            <div className="hv-result-row">
              <span className="k">Resting heart rate</span>
              <span className="v">{Math.round(classified.hrBpm)} bpm</span>
            </div>
            <div className="hv-result-row">
              <span className="k">HRV · RMSSD</span>
              <span className="v">{classified.hrvRmssdMs != null ? `${classified.hrvRmssdMs.toFixed(0)} ms` : '-'}</span>
            </div>
            <div className="hv-result-row">
              <span className="k">HRV · SDNN</span>
              <span className="v">{classified.sdnnMs != null ? `${classified.sdnnMs.toFixed(0)} ms` : '-'}</span>
            </div>
            <div className="hv-result-row">
              <span className="k">Beats detected</span>
              <span className="v">{classified.beatCount}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', marginTop: 'var(--s-2)' }}>
              <span className="hv-chip" data-k={classified.hrClassification}>
                {classified.hrClassification === 'normal' ? 'Within typical range'
                  : classified.hrClassification === 'tachycardia' ? 'Above typical range'
                  : classified.hrClassification === 'bradycardia' ? 'Below typical range'
                  : 'Reading'}
              </span>
              {classified.quality?.reasons?.includes('fallback_roi') && (
                <span className="hv-chip" data-k="fallback">Read wider patch</span>
              )}
            </div>
          </section>

          {report && (
            <div className="hv-report">
              <p className="headline">{report.headline}</p>
              {report.interpretation && <p className="interp">{report.interpretation}</p>}
              {Array.isArray(report.actions) && (
                <ul className="hv-actions">
                  {report.actions.map((a, i) => (
                    <li className="hv-action" key={i}>
                      <span className="num">{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        <span className="t">{a.title}</span>
                        <span className="d">{a.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {report.whenToWorry && (
                <div className="hv-worry"><strong>When to see a GP. </strong>{report.whenToWorry}</div>
              )}
            </div>
          )}

          <button className="hv-btn-ghost" onClick={() => runCapture(0)}>Retake the reading</button>
        </>
      )}

      {stage === 'error' && (
        <div className="hv-error">{error || 'Something went wrong with the heart screen.'}</div>
      )}

      {onBack && stage !== 'record' && stage !== 'prep' && (
        <button className="hv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the client**

Run: `cd client && npx vite build`
Expected: `✓ built` and the bundle now reports a new lazy chunk for `@mediapipe/tasks-vision`.

- [ ] **Step 3: Commit**

```bash
git add client/src/views/HeartView.jsx
git commit -m "feat(heart): HeartView prep + record + analyzing + result + coaching + error flow"
```

---

### Task 13: ParticipantView — wire `heart` stage + Heart CTA from Results / Neuro

**Files:**
- Modify: `client/src/views/ParticipantView.jsx`

- [ ] **Step 1: Import HeartView**

Edit `client/src/views/ParticipantView.jsx`. After the existing `import NeuroView from './NeuroView.jsx';` (around line 8), add:

```jsx
import HeartView from './HeartView.jsx';
```

- [ ] **Step 2: Add `heart` stage routing**

Edit `client/src/views/ParticipantView.jsx`. The `{stage === 'neuro' && ( ... )}` block is around line 767. After its closing parenthesis, and before `{stage === 'error' && ( ... )}`, insert:

```jsx
      {stage === 'heart' && (
        <HeartView
          demographics={demographicsRef.current}
          onBack={() => setStage(estimate ? 'results' : 'blow')}
        />
      )}
```

Also extend the existing `onNeuro={() => setStage('neuro')}` prop on `<ResultsView ...>` (around line 763) with an `onHeart={() => setStage('heart')}` prop. The updated `<ResultsView>` block:

```jsx
        <ResultsView
          estimate={estimate}
          analysis={analysis}
          onRetry={resetToBlow}
          onStartOver={resetToOnboarding}
          onNeuro={() => setStage('neuro')}
          onHeart={() => setStage('heart')}
        />
```

Extend the `<NeuroView>` block (around line 768) with `onHeart={() => setStage('heart')}`:

```jsx
        <NeuroView
          demographics={demographicsRef.current}
          onBack={() => setStage(estimate ? 'results' : 'blow')}
          onHeart={() => setStage('heart')}
        />
```

- [ ] **Step 3: Build**

Run: `cd client && npx vite build`
Expected: `✓ built`, no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/views/ParticipantView.jsx
git commit -m "feat(heart): wire heart stage into ParticipantView state machine"
```

---

### Task 14: ResultsView — add Heart CTA

**Files:**
- Modify: `client/src/views/ResultsView.jsx`

- [ ] **Step 1: Add `onHeart` prop and render a second CTA**

Edit `client/src/views/ResultsView.jsx`. The function signature is around line 547. Update it to:

```jsx
export default function ResultsView({ estimate, analysis, onRetry, onStartOver, onNeuro, onHeart }) {
```

The action row that holds the existing Neuro CTA is around line 698:

```jsx
      <div className="rv-action-row">
        {onNeuro && (
          <button className="rv-neuro-cta" onClick={onNeuro}>
            <span>Try the Neuro screen</span>
            <span className="arrow">→</span>
          </button>
        )}
        <button className="rv-ghost" onClick={onRetry}>Blow again</button>
```

Replace it with the Heart CTA inserted after the Neuro one, both above the ghost retry:

```jsx
      <div className="rv-action-row">
        {onNeuro && (
          <button className="rv-neuro-cta" onClick={onNeuro}>
            <span>Try the Neuro screen</span>
            <span className="arrow">→</span>
          </button>
        )}
        {onHeart && (
          <button className="rv-neuro-cta" onClick={onHeart}>
            <span>Try the Heart screen</span>
            <span className="arrow">→</span>
          </button>
        )}
        <button className="rv-ghost" onClick={onRetry}>Blow again</button>
```

- [ ] **Step 2: Build**

Run: `cd client && npx vite build`
Expected: `✓ built`, no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/views/ResultsView.jsx
git commit -m "feat(heart): Results view exposes Heart CTA alongside Neuro"
```

---

### Task 15: NeuroView — add Heart CTA after gait done

**Files:**
- Modify: `client/src/views/NeuroView.jsx`

- [ ] **Step 1: Accept `onHeart` and render the CTA below the back button**

Edit `client/src/views/NeuroView.jsx`. The function signature is around line 687:

```jsx
export default function NeuroView({ onBack, demographics }) {
```

Change to:

```jsx
export default function NeuroView({ onBack, demographics, onHeart }) {
```

The back button block is at the very bottom around line 1066:

```jsx
      {onBack && (
        <button className="nv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
```

Insert an `onHeart` CTA above it. Replace those three lines with:

```jsx
      {onHeart && stage === 'gait_done' && (
        <button className="nv-btn" onClick={onHeart}>
          <span>Try the Heart screen</span>
          <span className="arrow">→</span>
        </button>
      )}
      {onBack && (
        <button className="nv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
```

- [ ] **Step 2: Build**

Run: `cd client && npx vite build`
Expected: `✓ built`, no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/views/NeuroView.jsx
git commit -m "feat(heart): Neuro view exposes Heart CTA after gait test completes"
```

---

### Task 16: ProjectorView — 4th stat + heart flash + WS handler

**Files:**
- Modify: `client/src/views/ProjectorView.jsx`

- [ ] **Step 1: Add heart-flash CSS**

Edit `client/src/views/ProjectorView.jsx`. The `.pj-flash` block ends around line 545 (after `.pj-flash-team {...}` closes). Insert after that block, BEFORE `@keyframes pj-flash-in`:

```css
  .pj-flash-heart {
    position: fixed;
    top: 8.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: baseline;
    gap: 1.2rem;
    padding: 0.85rem 1.5rem;
    background: rgba(18, 19, 26, 0.9);
    border: 1px solid var(--warn);
    border-radius: 999px;
    box-shadow: 0 0 40px rgba(209, 133, 137, 0.35), 0 20px 60px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    animation: pj-flash-in 0.4s cubic-bezier(0.22, 1, 0.36, 1),
               pj-flash-out 0.5s ease-in 2.7s forwards;
    white-space: nowrap;
  }
  .pj-flash-heart[data-grade="fair"] { border-color: var(--brass-line); }
  .pj-flash-heart[data-grade="poor"] { border-color: var(--hairline-strong); }
  .pj-flash-heart .lab {
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #f0c4c8;
  }
  .pj-flash-heart .num {
    font-family: var(--font-display);
    font-size: 1.7rem;
    line-height: 1;
    color: var(--bone-0);
    font-variant-numeric: tabular-nums;
  }
  .pj-flash-heart .unit {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--bone-3);
    margin-left: 0.3rem;
  }
```

Also update `.pj-stats` from `repeat(3, 1fr)` to a class-driven 3-or-4 column layout. Replace the `.pj-stats {...}` block (around line 213) with:

```css
  .pj-stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
  }
  .pj-stats[data-heart="on"] { grid-template-columns: repeat(4, 1fr); }
```

- [ ] **Step 2: Add heart state and flash handler**

Edit `client/src/views/ProjectorView.jsx`. The `ProjectorView()` body declares state around line 618. After `const [flashBlow, setFlashBlow] = useState(null);`, add:

```jsx
  const [flashHeart, setFlashHeart] = useState(null);
  const flashHeartTimerRef = useRef(null);
```

The `ws.onmessage` handler is around line 644. Inside the `try { const msg = JSON.parse(...) ... }` chain of `if (msg.type === 'blow')` / `else if (msg.type === 'narrator_*')`, add a new branch BEFORE the closing of the try block. After the existing `else if (msg.type === 'narrator' && msg.state) { ... }` block, add:

```jsx
          else if (msg.type === 'heart' && msg.state) {
            setState(msg.state);
            if (msg.heart) {
              setFlashHeart({ ...msg.heart, ts: Date.now() });
              if (flashHeartTimerRef.current) clearTimeout(flashHeartTimerRef.current);
              flashHeartTimerRef.current = setTimeout(() => setFlashHeart(null), 3200);
            }
          }
```

- [ ] **Step 3: Render the 4th stat cell + heart flash**

Edit `client/src/views/ProjectorView.jsx`. The `<div className="pj-stats">` block is around line 771. Replace it with:

```jsx
            <div className="pj-stats" data-heart={state?.heart?.heartCount > 0 ? 'on' : 'off'}>
              <div className="pj-stat">
                <span className="k">Check-ins</span>
                <span className="v">{pc}</span>
                <span className="u">people</span>
              </div>
              <div className="pj-stat">
                <span className="k">Mean</span>
                <span className="v">{meanPct != null ? Math.round(meanPct) : '-'}</span>
                <span className="u">% predicted</span>
              </div>
              <div className="pj-stat">
                <span className="k">Flagged</span>
                <span className="v flagged">{flagged}</span>
                <span className="u">for GP follow-up</span>
              </div>
              {state?.heart?.heartCount > 0 && (
                <div className="pj-stat">
                  <span className="k">Mean HR</span>
                  <span className="v">{state.heart.meanHrBpm != null ? Math.round(state.heart.meanHrBpm) : '-'}</span>
                  <span className="u">{state.heart.heartCount} hearts read</span>
                </div>
              )}
            </div>
```

The existing `{flashBlow && ( ... )}` block is around line 838. After its closing parenthesis, and before the `<button className="pj-reset" ...>` block, insert:

```jsx
      {flashHeart && (
        <div className="pj-flash-heart" data-grade={flashHeart.grade} key={flashHeart.ts}>
          <span className="lab">New pulse on the board</span>
          <span className="num">{flashHeart.hrBpm}<span className="unit">bpm</span></span>
          {flashHeart.teamCode && (
            <span className="pj-flash-team">team {flashHeart.teamCode}</span>
          )}
        </div>
      )}
```

- [ ] **Step 4: Build**

Run: `cd client && npx vite build`
Expected: `✓ built`, no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/views/ProjectorView.jsx
git commit -m "feat(heart): projector 4th stat cell + heart flash toast + WS heart handler"
```

---

### Task 17: README privacy + scratchpad Phase 5

**Files:**
- Modify: `README.md`
- Modify: `scratchpad.md`

- [ ] **Step 1: Add the rPPG privacy sentence to README**

Edit `README.md`. Find the existing `## Privacy` section (or whatever heading lists "no raw audio upload" / similar). Insert the following sentence as a new bullet at the end of the privacy list, or as a new paragraph beneath it:

```
- Video frames for rPPG are reduced to per-frame RGB ROI means inside the browser; raw pixels never leave the device.
```

If the README's privacy block uses a paragraph rather than a bullet list, append a sentence to the paragraph instead:

```
Video frames for rPPG (Module 03 Heart) are reduced to per-frame RGB ROI means inside the browser; raw pixels never leave the device.
```

(Whichever style the file already uses — match it.)

- [ ] **Step 2: Append a Phase 5 block to scratchpad.md**

Edit `scratchpad.md`. After the existing Phase 4 block (which is the last entry), append:

```markdown

### Phase 5: Module 03 (Heart), COMPLETE (2026-05-12) ✅

rPPG heart-rate + HRV from 30s front-camera capture. POS (Wang 2017) on
forehead + combined cheeks ROIs, MediaPipe Tasks Vision first-frame face
detect with 3-retry then fallback ROI, FFT-derived HR with parabolic
interpolation, freq-domain bandpass + peak-detect for RMSSD/SDNN. Quality
grades good/fair/poor; poor short-circuits to CoachingCard without showing
a number. AI personal report from HEART_REPORT_SYSTEM with template
fallback. Projector gets 4th stat cell (Mean HR / N hearts read) plus a
heart flash toast.

- [x] `server/prompts.js`, `HEART_REPORT_SYSTEM` + `buildHeartReportUserMessage`, scrub-token extension.
- [x] `server/index.js`, `POST /api/analyze-heart`, `recordHeart`, `room.heartParticipants`, `/health` modules list, `/api/admin/reset` clears heart.
- [x] `client/src/video/pos.js` + unit test (synthetic 1.2 Hz pulse).
- [x] `client/src/video/features.js` + unit tests (72 bpm round-trip, flat-signal grades poor).
- [x] `client/src/video/regression.js` + unit tests (HR class, HRV class, ageNote).
- [x] `client/src/video/recorder.js`, camera permission, MediaPipe face detect (lazy ESM import, pinned @mediapipe/tasks-vision@0.10.21), per-frame ROI mean sampling into a module-scoped offscreen canvas.
- [x] `client/src/views/HeartView.jsx`, intro → prep → face-detect → record → analyzing → result | coaching | error.
- [x] `client/src/views/ParticipantView.jsx`, ResultsView, NeuroView, ProjectorView wired up.
- [x] `client/src/api.js`, `analyzeHeart` helper.
- [x] README privacy line added.
- [x] `node --test client/src/video/__tests__/*.test.js` green.
- [x] `npm run build --workspace=client` green.
- [ ] User-side: live capture on a real phone via ngrok, HR within ±10 bpm of a Polar / pulse-ox baseline.
- [ ] User-side: dim-light capture grades poor + CoachingCard renders.
- [ ] User-side: projector 4th stat cell + heart flash toast verified.
```

- [ ] **Step 3: Commit**

```bash
git add README.md scratchpad.md
git commit -m "docs(heart): README privacy sentence + scratchpad Phase 5 entry"
```

---

### Task 18: Push and verify

**Files:** none.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin claude/review-roadmap-planning-AE32F`
Expected: branch updates, no errors.

- [ ] **Step 2: Confirm the test command runs all heart unit tests in one go**

Run: `node --test client/src/video/__tests__/`
Expected: `tests 7 / pass 7 / fail 0` (1 from pos, 2 from features, 4 from regression).

- [ ] **Step 3: Final build sanity**

Run: `npm run build --workspace=client`
Expected: `✓ built in <Nms>` with one extra dynamic chunk for `@mediapipe/tasks-vision`.

---

## Self-review notes

**Spec coverage** (per `docs/superpowers/specs/2026-05-12-module-03-heart-design.md`):

| Spec section | Plan tasks |
| --- | --- |
| Architecture overview | Tasks 7-10 (client video/ modules), Tasks 2-5 (server) |
| Capture & ROI (face detect, fallback, per-frame sampling, live HR badge) | Task 10 (recorder) + Task 12 (HeartView wires onLiveHr) |
| Signal processing (POS, HR via FFT + parabolic interp, HRV via freq-bandpass + peak detect, quality grading) | Tasks 7-8 |
| Classification bands + age note + scrub list | Task 9 (regression) + Task 4 (server scrub extension) |
| AI report contract (system prompt, input shape, schema, fallback) | Tasks 2, 4, 5 |
| UX & navigation (CTA from ResultsView and NeuroView, HeartView states, palette) | Tasks 11, 12, 13, 14, 15 |
| Projector (4th stat cell, heart flash, WS message) | Task 16 (client) + Task 5 (server broadcast) |
| Narrator scope (NOT extended in v1) | Implicit — no task touches NARRATOR_SYSTEM |
| Privacy contract (offscreen canvas never attached, only RGB means leave) | Task 10 implementation; Task 17 README |
| Test plan (server smoke, math unit tests, build, live UI verification) | Tasks 5 (curl smoke), 7-9 (unit tests), 18 (final build); live UI ticks in Task 17 scratchpad |
| Acceptance criteria | Captured in Task 17 scratchpad entry |

**Open implementation questions from the spec, resolved here:**
- MediaPipe version: `@mediapipe/tasks-vision@0.10.21` (Task 1).
- Vendor vs CDN: CDN fetch at runtime (Task 10, `cdn.jsdelivr.net` for wasm, `storage.googleapis.com` for the BlazeFace tflite). Documented in the code comment near `getFaceDetector()`.
- Live HR badge: kept, but only renders after 5 s of samples (Task 10 + 12).
- Recorder face-detect contract: returns `{ kind: 'face', rois } | { kind: 'no-face' }`; the caller (Task 12) handles retry-then-fallback. Cleaner than polling.
