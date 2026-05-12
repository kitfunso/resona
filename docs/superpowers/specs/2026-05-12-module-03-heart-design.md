# Module 03 · Heart — Design Spec

- **Date:** 2026-05-12
- **Status:** Approved by user via brainstorming flow (sections 1–6)
- **Branch:** `claude/review-roadmap-planning-AE32F`
- **Phase:** Phase 5 (per `scratchpad.md` naming convention)
- **Prior art:** README/PITCH list this as a Q3 2026 roadmap item. A first unplanned attempt was reverted in `8516e5d` so we could plan properly.

## Purpose

Add the third Resona modality — heart rate plus heart rate variability from a 30-second front-camera capture using remote photoplethysmography (rPPG). Module 03 sits beside Breath (Module 01) and Neuro (Module 02) under the same architectural contract: capture in the browser, extract numeric features locally, POST only the features to the server, render a personal AI report on phone, aggregate on the projector.

Audience framing is workplace wellness, not clinical cardiology. This is a screening estimate with wide error bars, and the UI and AI prompt both say so out loud.

## Locked decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Demo context | Post-hackathon, build it properly. No demo-day cramming. |
| Signals extracted | Resting HR + HRV (RMSSD, SDNN). No SpO2, no breathing rate. |
| rPPG algorithm | POS (Wang et al. 2017). Green-only and CHROM rejected. |
| ROI strategy | First-frame face detect (MediaPipe), static forehead + cheek ROIs thereafter. Fixed-ROI fallback after 3 detection failures, surfaced as a chip. |
| Quality UX | Coaching card on poor signal (mirrors Breath's invalid-blow pattern). Numbers never shown on poor capture. |
| AI output | Personal report only (`headline`, `interpretation`, 3 `actions`, `whenToWorry`). No GP letter. |
| User journey | Follow-on CTA from Breath ResultsView and Neuro NeuroView. No standalone entry from onboarding. |
| Projector role | Fourth stat cell (Mean HR / N hearts read) + per-capture flash toast. No second co-op goal bar. |
| Narrator | v1: not extended to mention heart. Snapshot includes heart fields; narrator system prompt stays anchored on lung-litres. |

## Architecture

```
client/src/
  video/
    recorder.js       getUserMedia(front camera) + per-frame {r,g,b} ROI means
                      + lazy-loaded first-frame face detection
    pos.js            POS algorithm: per-ROI RGB -> 1D pulse signal S
    features.js       Detrend, FFT (HR), bandpass + IFFT + peak detect (HRV)
                      Quality SNR / reasons
    regression.js     HR/HRV classification bands, ageNote, quality grade
  views/
    HeartView.jsx     Intro -> permission -> 5s prep -> face-detect ->
                      30s record -> analyzing -> result | coaching | error

server/
  prompts.js          + HEART_REPORT_SYSTEM, + buildHeartReportUserMessage
                      scrubInternalTokens extended with heart class tokens
  index.js            + POST /api/analyze-heart  (records, broadcasts, GLM + fallback)
                      + room.heartParticipants map, + heartSnapshot()
                      + recordHeart(), + heartReportFallback()
                      /health declares ["Breath","Neuro","Heart"]
                      /api/admin/reset clears heart state

client/src/api.js     + analyzeHeart({heart, demographics})
```

**Data flow.**

```
HeartView
   │  acquireCameraPermission()  (separate from prep countdown)
   │  prep 5s + audio cue
   │  faceDetectFirstFrame()  (MediaPipe Tasks Vision, lazy import)
   │  captureRppg(30s)  -> Float32Array(frames × 6) RGB samples + timestamps
   │     onSample: rolling-tail zero-crossing -> live HR badge
   ▼
features.extractHeartFeatures(samples, timestamps, roiInfo)
   resample 30 Hz
   POS per ROI -> pulse signal S (forehead + cheeks averaged)
   FFT 0.7–4 Hz -> hrBpm
   FFT bandpass + IFFT + peakDetect -> RR intervals -> RMSSD, SDNN
   SNR, beatCount, hrFromRr, reasons[]
   ▼
regression.estimateHeart(features, demographics)
   classify HR / HRV / age notes
   grade(quality.grade ∈ {good, fair, poor})
   ▼
api.analyzeHeart({ heart, demographics, sessionId })
   ▼
POST /api/analyze-heart
   recordHeart()  -> room.heartParticipants
   broadcastToProjectors({ type:"heart", heart, state })
   if quality.grade === 'poor':
       return { ok:false, coaching:{ message } }   (server-template)
   else:
       askGLMJsonWithRetry(HEART_REPORT_SYSTEM, …)
       fallback on parse failure
       scrubReport(report)
       return { ok:true, report }
   ▼
HeartView renders result | coaching
ProjectorView updates pj-stats 4th cell + flashes pj-flash
```

## Capture & ROI

### Camera + permission

- `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false })`
- Mirror preview with `transform: scaleX(-1)`.
- Permission acquired in a one-off `acquireCameraPermission()` helper called BEFORE the prep countdown begins. iOS Safari does not require an audio-style unlock for video, but the OS dialog will steal focus and we don't want it landing mid-countdown.

### First-frame face detection

- Lazy-import `@mediapipe/tasks-vision` only when HeartView opens (not at app boot). Use a dynamic `await import(...)` so esbuild/Vite code-splits it into its own chunk. Pin to a specific version in `package.json` (TBD at install time — pick the latest 0.10.x).
- Load `FaceDetector` model. On the first captured frame (during prep), run a single `detect()` call to get a face bounding box.
- Derive two ROI groups from the bbox:
  - **Forehead:** centred horizontally, top 20% of face height, 50% of face width.
  - **Cheeks (combined):** two rectangles either side of nose, each 25% × 25% of face area at mid-face height. Sampled into one 32×16 strip canvas so they yield a single combined RGB mean per frame (not separate left / right channels).
- ROIs are locked once at start-of-capture. We do not track the face per frame (POS plus a 30s static ROI is the documented mainstream approach; per-frame tracking is a future v2 optimisation).
- On failure (no face, multiple faces, or model load error): show inline "We couldn't see your face — centre yourself in the oval and tap retry". Allow up to 3 retries. After 3 failures: fall back to fixed centre ROI (40% × 45% block), record `fallback_roi` in the features' `reasons[]`, surface a non-blocking chip on the result card.

### Per-frame sampling

- Offscreen canvas 32 × 32 (forehead) plus a second 32 × 16 strip (cheeks). Never attached to the DOM.
- `rAF` loop: for each frame, draw ROI crops into the offscreen canvas, read `ImageData`, compute mean R / G / B per ROI.
- Push `{ tMs, foreheadR, foreheadG, foreheadB, cheeksR, cheeksG, cheeksB }` into a flat `Float32Array` (length `frames × 7` including timestamp).
- For a 30s × 30fps capture this is ~6300 floats = ~25 KB total. Only this array and its derived features cross any API boundary.

### Live HR badge during capture

- Rolling 8s tail of forehead-green channel.
- Subtract mean, count zero-crossings, halve to get beat count, then divide by the window seconds and multiply by 60 → bpm.
- Update once per ~1s during capture, only when ≥ 5s of samples present and the result lies in [40, 200] bpm.
- Decoration only. The final HR is computed by `features.extractHeartFeatures` after capture ends.

## Signal processing

### Resample

- rAF frame deltas are not uniform. Linearly interpolate R, G, B per ROI onto a uniform 30 Hz grid using the recorded `tMs` timestamps.

### POS (Wang et al. 2017)

Per ROI:
1. Rolling 1.6s window normalisation: `C_n(t) = C(t) / mean_w(C)` per channel, where `mean_w` is a windowed running mean. Prevents long-term lighting drift dominating the projection.
2. Project onto two skin-orthogonal axes: `X = R_n - G_n`, `Y = R_n + G_n - 2·B_n`.
3. Per window: `α = std(X) / std(Y)`. `S = X + α·Y`.

Per capture: average the forehead and cheeks `S` signals → final 1D pulse signal `pulse`.

### HR extraction

- Hann-window `pulse` over its full length (no segmentation — 30s is short enough to use one FFT).
- FFT.
- Peak magnitude in 0.7–4 Hz (42–240 bpm).
- Parabolic interpolation around the peak bin for sub-bin frequency precision.
- `hrBpm = peakHz * 60`, rounded to one decimal.

### HRV extraction

- Frequency-domain bandpass: copy FFT bins inside 0.7–4 Hz (and their negative-frequency mirrors) into a new spectrum, zero the rest, inverse FFT → real-valued filtered pulse trace.
- Local-max peak detector on the filtered trace:
  - Refractory window: `0.35s` worth of samples (rejects beats closer than HR ≤ 170 bpm apart).
  - Amplitude floor: 20% of the absolute peak swing in the trace.
- `peakIndices[]` → consecutive deltas in ms → `RR[]`.
- Clamp RR intervals to [250 ms, 2000 ms]. Anything outside is artefact.
- `hrvRmssdMs = sqrt(mean((RR[i+1] - RR[i])²))` over consecutive differences.
- `sdnnMs = sqrt(var(RR))` over all RR intervals.

### Quality grading

- `snr = peakBinPower / meanOtherInBandPower` (squared magnitude).
- `hrFromRr = 60000 / mean(RR)` if `RR.length >= 3`, else null.
- `reasons[]` accumulates these tags:
  - `low_snr` — snr < 1.5
  - `few_frames` — framesUsed < 600
  - `few_beats` — RR.length < 20
  - `hr_methods_disagree` — `|hrBpm - hrFromRr| > 15`
  - `no_peak` — FFT peak missing (signal flat-line, all-NaN, etc.)
  - `fallback_roi` — face detection failed, fixed ROI used
- Grade:
  - 0 reasons → `good`
  - 1 reason → `fair`
  - ≥ 2 reasons OR `no_peak` present → `poor`

### Classification bands (server-internal tokens)

- HR: `bradycardia` (< 60), `normal` (60–100), `tachycardia` (> 100)
- HRV: `low` (< 20 ms), `typical` (20–80 ms), `high` (> 80 ms)
- Age note: `low_for_young_adult` (age < 25 AND HR < 55), `high_for_older_adult` (age > 60 AND HR > 90)

**These tokens must never appear in user-facing text.** Both the system prompt (instructs LLM to translate) and `scrubInternalTokens` (regex safety net) handle this.

## AI report contract

### System prompt

New `HEART_REPORT_SYSTEM` in `server/prompts.js`, modelled on `NEURO_REPORT_SYSTEM`. Key rules baked in:

- Workplace-wellness framing; not cardiology.
- Use injected numbers verbatim, never invent.
- Translate every classification token (HR class, HRV class, ageNote, quality reasons) into natural English in every output.
- On tachycardia (good signal): "above the typical resting range", action set focused on caffeine / stress / 5-minute seated retest, when-to-worry on "stays above 100 across several quiet readings".
- On bradycardia (good signal): "below the typical resting range, often fitness in healthy adults", action set focused on watching for symptoms (dizziness / fainting / breathlessness).
- On normal + low HRV: at least one action MUST address recovery (sleep, alcohol, caffeine cut-off, walking breaks).
- On high HRV: brief positive note; do NOT suggest "increase HRV" actions.
- Different inputs MUST yield different action sets. Vary by HR class × HRV class × age × ageNote.
- British English. No em dashes.
- Return only the JSON schema below — no preamble, no markdown.

Output schema (identical shape to Neuro / Personal Report, so the existing React result card chrome is reusable):

```json
{
  "headline": "string (under 10 words; never include HR number if quality is poor)",
  "interpretation": "string (2-3 sentences using injected numbers)",
  "actions": [
    { "title": "string (verb-led, under 8 words)", "detail": "string (one sentence)" },
    { "title": "string", "detail": "string" },
    { "title": "string", "detail": "string" }
  ],
  "whenToWorry": "string (one sentence with an explicit symptom or threshold)"
}
```

### Input shape

`buildHeartReportUserMessage({ heart, demographics })` produces:

```json
{
  "patient": { "name", "ageYears", "sex", "ethnicity", "teamCode" },
  "heart": {
    "hrBpm": <number rounded to int>,
    "hrvRmssdMs": <number or null>,
    "sdnnMs": <number or null>,
    "snr": <number or null>,
    "beatCount": <int>,
    "durationSec": <int>,
    "hrClassification": "normal" | "bradycardia" | "tachycardia" | "unknown",
    "hrvClassification": "typical" | "low" | "high" | "unknown",
    "quality": { "grade": "good" | "fair" | "poor", "reasons": ["..."] },
    "ageNote": "low_for_young_adult" | "high_for_older_adult" | null
  }
}
```

### Server pipeline

`POST /api/analyze-heart`:
1. Validate payload (must have `heart` object).
2. `teamCode` normalised (uppercase, max 6 chars).
3. `recordHeart()` updates `room.heartParticipants` and `room.newestHeartHrBpm`.
4. `broadcastToProjectors({ type: "heart", heart, state: roomSnapshot() })`.
5. If `quality.grade === 'poor'`: return `{ ok: false, coaching: { message: <template-derived> } }`. No LLM call.
6. Else: `askGLMJsonWithRetry(HEART_REPORT_SYSTEM, buildHeartReportUserMessage, …)`, tag `heart-report`, `temperature: 0.8`, `max_tokens: 2000`.
7. On parse failure or missing `headline` / `actions`: `heartReportFallback({ heart })` covers normal / tachy / brady branches.
8. `scrubReport(report)` to defend against token leakage.
9. Return `{ ok: true, report }`.

### Fallback templates

`heartReportFallback({ heart })`:
- **poor** branch never fires from this function (server short-circuits before reaching it). Kept as a guard in case the LLM somehow returns malformed JSON on a good-quality capture.
- **tachycardia** branch: headline "Resting heart rate came in around N bpm.", interpretation about above-typical-range + camera-stage-anxiety effect, 3 actions (seated reset, caffeine audit, track if persists), when-to-worry on "stays above 100".
- **bradycardia** branch: headline "Resting heart rate came in around N bpm.", interpretation about below-typical / fitness signature, 3 actions (note symptoms, keep training, retest after walk), when-to-worry on dizziness / fainting.
- **normal** branch: headline "Your resting heart rate landed around N bpm.", interpretation referencing HRV if present, 3 actions (hourly walks, sleep, Monday retest), when-to-worry on sudden palpitations.

### Scrub list extension

`scrubInternalTokens` gets these new regex replacements:
- `\btachycardia\b` → "a higher resting heart rate"
- `\bbradycardia\b` → "a lower resting heart rate"
- `\blow_for_young_adult\b` → "lower than the typical young adult range"
- `\bhigh_for_older_adult\b` → "higher than the typical older adult range"
- `\b(low_snr|few_frames|few_beats|hr_methods_disagree|no_peak|fallback_roi)\b` → "a noisy reading"

## UX & navigation

### ParticipantView routing

Add a `heart` stage to the existing state machine:

```
onboarding → blow → armed → recording → analyzing → results | coaching
                                                       ↓ onHeart
                                                     heart   ←— onHeart from neuro
                                                       ↓ onBack
                                                     results | blow
```

`HeartView` is given `demographics` (already collected at onboarding) and `onBack` (returns to whichever stage the user came from — Breath results, or Neuro).

### CTA placement

- `ResultsView` (Breath results): a third gold `rv-neuro-cta`-styled button "Try the Heart screen" added beside the existing Neuro CTA. Only rendered when `onHeart` prop is passed.
- `NeuroView`: after `stage === 'gait_done'`, add a "Try the Heart screen" button beside "Back to your reading". Only rendered when `onHeart` prop is passed.
- Order on ResultsView: Neuro CTA first, Heart CTA second. (Matches module numbering: 01 Breath → 02 Neuro → 03 Heart.)

### HeartView states

| Stage | What renders |
| --- | --- |
| `intro` | Header card, "Frame your face in the oval. 30 seconds." copy, "Start heart screen" primary button. |
| `prep` | Live preview begins; 5s big numeric countdown; "Centre your face in the oval" hint. Audio start cue at countdown end (reuses `getAudioContext()` + oscillator from NeuroView). |
| `face-detect` | Sub-state inside `prep`. Detector runs on first usable frame; on success → `record`; on failure → retry banner. |
| `record` | Mirrored preview with dimmed oval overlay, live HR badge, thin progress bar under preview, countdown number. |
| `analyzing` | `nv-analyzing-bars` animation reused. Caption: "Reading the pulse..." |
| `result` | Readings card (HR / HRV-RMSSD / SDNN / beats detected), HR classification badge, optional `fallback_roi` chip, AI report card styled like `nv-report`. "Retake the reading" + "Back" buttons. |
| `coaching` | `CoachingCard` reused from `ResultsView`. Message from server-template. "Retake" returns to `intro`. |
| `error` | Permission denied / camera unavailable. |

### Visual language

- Cream / ink / brass palette, Young Serif + Manrope + JetBrains Mono — same as Breath/Neuro.
- Heart progress-bar fill uses `--warn` (terracotta) instead of brass, to give the third module a distinct semantic. (Brass = breath, brass = neuro tremor, terracotta = heart.) All other tokens identical to Neuro's `nv-*` classes.
- Reuse Neuro's `.nv-step`, `.nv-prep`, `.nv-record`, `.nv-band`, `.nv-report` shapes; prefix with `hv-*` for component isolation.

### Projector

- `pj-stats` grid CSS: `grid-template-columns: repeat(3, 1fr)` becomes `repeat(4, 1fr)` only when `state.heart.heartCount > 0`. Fourth cell: "Mean HR" key, big numeric value, caption "N hearts read".
- New flash toast `pj-flash` with `top: 8.5rem` (offset below the existing `pj-flash` at `top: 5rem` for breath blows). Animation reused. `data-kind="first"` for the first capture per session (pulse-green border), `data-kind="retry"` for re-takes (muted border).
- WebSocket protocol extends with one new message type: `{ type: "heart", heart: {...}, state: {...} }`. Existing messages unchanged.

### Narrator scope

NARRATOR_SYSTEM stays anchored on lung-litres in v1. Room snapshot includes `state.heart` so the prompt sees it, but the system prompt does not instruct on heart language. Decision deferred to v2 once we have a few real captures and can see whether the narrator naturally calls out heart.

## Privacy contract

- **Camera permission and live preview** is the only point where any pixel-bearing media element exists in the DOM (the `<video>` showing the live mirrored preview). Even there, the stream is `srcObject`-bound directly from `getUserMedia` and is stopped on capture-end.
- **No `<canvas>` element is ever attached to the DOM.** The offscreen canvas used by `recorder.js` is created via `document.createElement('canvas')`, kept in module scope, and never appended.
- **No raw frames are stored.** `ctx.getImageData` is called per frame, the per-channel ROI mean is computed immediately, and the ImageData reference is released to GC.
- **What leaves `recorder.js`:** A `Float32Array` of length `frames × 7` (timestamp + 3 channels × 2 ROIs), about 25 KB for a 30s capture.
- **What leaves `features.js` → `regression.js`:** A small object `{ hrBpm, hrvRmssdMs, sdnnMs, snr, beatCount, durationSec, hrClassification, hrvClassification, quality: { grade, reasons }, ageNote }`, ≤ 1 KB.
- **What goes to the server in the POST body:** that small object plus already-existing `{ demographics, sessionId }`. The 25 KB array never crosses the wire.
- **MediaPipe model fetch:** the face-detector WASM/TFLite binaries are fetched from `cdn.jsdelivr.net` (or bundled if we precommit them). One-off network call before capture; no telemetry. Pin a specific MediaPipe version in `package.json`.

README's `## Privacy` section gets one new sentence: "Video frames for rPPG are reduced to per-frame RGB ROI means inside the browser; raw pixels never leave the device."

## Test plan

### Build / typecheck

1. `npm run build --workspace=client` clean.
2. `node --check` passes on `server/index.js`, `server/prompts.js`, and all new client files.

### Server smoke (via `curl`, no live UI required)

3. `POST /api/analyze-heart` with `quality.grade='good'` + `hrClassification='normal'` → 200, fallback `headline` references the injected HR.
4. `POST /api/analyze-heart` with `quality.grade='poor'` → 200, `{ ok: false, coaching }` shape; no HR number in the response anywhere.
5. `POST /api/analyze-heart` with `hrClassification='tachycardia'` → 200, fallback headline frames as "above typical range".
6. `POST /api/analyze-heart` with `hrClassification='bradycardia'` → 200, fallback headline frames as "below typical range".
7. `POST /api/admin/reset` → heart state cleared alongside breath state.

### Client-side math unit tests

8. `pos.js` on a synthetic RGB sequence with an injected 1.2 Hz pulse → the resulting `S` signal's FFT peak is within ±0.05 Hz of 1.2 Hz.
9. `features.js` peak detector on a synthetic 72 bpm sine wave → `hrBpm ≈ 72 ± 1`, `RR.length` matches expected beat count to within ±1.
10. Quality grading: feed flat signal → `grade === 'poor'` with `no_peak` reason present.

### Live UI verification (user-side, after merge)

11. ngrok HTTPS, open `/` on phone, complete a blow, navigate to Heart, complete a 30s capture in good even light → reported `hrBpm` within ±10 bpm of a Polar / pulse oximeter ground truth.
12. Repeat capture under deliberately bad conditions (dim light, big head movement) → quality grades to `poor`, CoachingCard renders, no HR number shown.
13. Projector at `/projector` — Heart stat 4th column appears after first capture, flash toast fires correctly.

## Acceptance criteria for v1 merge

- Tests (1)–(10) pass.
- Manual tests (11)–(13) ticked by user in `scratchpad.md` before closing Phase 5.
- README `## Privacy` section updated with the rPPG sentence.
- `scratchpad.md` Phase 5 entry recorded with the same level of detail as Phases 0–3.

## Out of scope (deferred to v2 or later)

- Per-frame face tracking (would handle small head movement during capture).
- Narrator system prompt extension.
- Standalone Heart entry from `OnboardingView`.
- CHROM or POS-with-skin-mask refinement.
- SpO2 / breathing rate / mental-load voice stress (separate roadmap items).
- GP letter output.
- Postgres / SOC2 production data plan.

## Open implementation questions to resolve during writing-plans

- Exact MediaPipe version to pin in `package.json`.
- Whether to vendor the MediaPipe model files into the repo (offline-safe, +~3 MB committed) or fetch from CDN at runtime.
- Whether `recorder.js` should expose a callback for first-frame face-detection success/failure so HeartView can transition states cleanly, or whether the state machine should poll.
- Whether the live-HR badge zero-crossing estimate is worth keeping (it can be misleading in early seconds — alternative: hide until 8s elapsed).
