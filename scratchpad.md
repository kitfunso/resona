# Resona scratchpad

Read this at the start of every new session. Update at the end of every phase.

## Product

- Name: Resona (codename: not-a-doctor)
- Tagline: "Every body has a rhythm."
- Demo: Watcha Global AI Hackathon 2026, London, Sunday pitch
- 2-min live pitch, 100+ audience blow into phones via QR, projector shows co-op boss-fight leaderboard

## Pinned decisions

- LLM model: `glm-5.1` (Z.ai flagship, reasoning on, `max_tokens: 2000`)
- Base URL: `https://api.z.ai/api/paas/v4/`
- Auth: standard `Authorization: Bearer <key>`
- No GLM-specific params in use. All calls via OpenAI SDK.
- SQLite: in-memory only (`:memory:`). Ephemeral. Dies on restart.
- No email. No raw audio upload. No video. One modality: acoustic spirometry.
- HTTPS via ngrok for iOS mic access. No SSL provisioning in code.

## Pinned dependency versions (exact, no ^ or ~)

Backend (`server/`):
- express 4.21.2
- ws 8.18.0
- better-sqlite3 11.7.0
- openai 4.77.0
- cors 2.8.5
- dotenv 16.4.7

Frontend (`client/`):
- react 18.3.1
- react-dom 18.3.1
- vite 5.4.11
- @vitejs/plugin-react 4.3.4

Root:
- npm-run-all 4.1.5

Node: >= 20.0.0

## Phase status

### Phase 0: Scaffolding & API Verification, COMPLETE
- [x] Monorepo structure (root `package.json` with workspaces)
- [x] `.env.example`, `.env`, `.gitignore`
- [x] `server/glm-service.js` with OpenAI SDK + `glm-trace.log` (sync append, survives `process.exit`)
- [x] `server/test-glm.js` standalone connectivity script
- [x] `server/index.js` Express + WS + SQLite (`:memory:`), `/health` route
- [x] `server/prompts.js` stubs (Phase 2/3 will fill)
- [x] `client/` Vite + React hello world with `/health` ping + fixed-position screening disclaimer
- [x] `README.md`
- [x] `scratchpad.md`
- [x] `npm install` clean (315 packages, `better-sqlite3@12.9.0` for Node 24 prebuilds)
- [x] `npm run test:glm` returns `Not-a-Doctor GLM check: READY` against `glm-5.1`
- [x] Backend boots on :3030, `/health` returns `{ok:true, glm:{model:"glm-5.1", configured:true}}`
- [x] Frontend `vite build` clean (30 modules, 144kb, 330ms)
- [x] `glm-trace.log` contains full request + full response bodies

### Phase 0 notes / deltas from brief
- **Port changed from 3000 → 3030.** Another process (PID 9652, probably Quantamental) owns :3000 on this machine. Updated `.env`, `.env.example`, Vite proxy.
- **better-sqlite3 bumped 11.7.0 → 12.9.0.** 11.x has no Node 24 prebuilt binaries and the Windows box lacks MSVC toolchain. 12.9.0 installs cleanly. Still Hankinson-grade ephemeral `:memory:` DB.
- **Trace log uses `appendFileSync`.** Async append lost writes when `test-glm.js` called `process.exit(0)` before the buffer flushed.
- **Dual dev server boot not verified via `npm run dev`.** The pre-bash-guard hook blocks long-running fan-out commands. Verified independently: server booted direct (`/health` OK), client `vite build` succeeded (config + deps valid).
- **First user run of `npm run dev` exposed two cwd/port bugs.** Fixed:
  1. `npm run dev --workspace=server` sets cwd to `server/`, so `import 'dotenv/config'` failed to find root `.env`. Fix: `glm-service.js` loads `.env` via explicit path `path.join(__dirname, '..', '.env')`. Removed the stale `import 'dotenv/config'` from `server/index.js` (glm-service loads it first).
  2. Port 5173 occupied (probably Quantamental frontend). Not-a-Doctor Vite port moved to 5174. README updated with new URLs.

### Phase 1: Spirometer math + audio capture, LOCKED (2026-04-18) ✅
Final signal: `activeSec05` (time envelope above 5% of own peak). Anchor 4.5s = 100% predicted, ±2s per score unit = ±15% predicted per second. Captures exponentially-tapered forced exhalation (turbulent flow noise scales with flow squared, so a real 5s blow crosses 10%-of-peak at ~2-3s but stays above 5%-of-peak for the full tapered tail).
- Live-phone + desktop verification passed across 4 bands: weak-quiet (🟠), weak-loud-short (🟠), normal (🟢), max (🔵).
- Calibration journey: started with peak+rms+tau weighted score (wrong, AGC-sensitive). Switched to two-stage (wrong, amplitude varies 3x by phone distance). Locked on duration-only: `effortScore = (activeSec20 - 3.0) / 2.0`, 15% predicted per second of sustained exhalation. Phone-position-invariant because activeSec20 is ratio-based within each blow's own peak.
- All three parameters (FEV1/FVC/PEF) share the same fraction. Ratios stay physiologic because sanity check enforces FVC≥FEV1.

- [x] `shared/reference-equations.js`, authentic Hankinson 1999 Caucasian adult coefficients (cross-verified via rspiro R package MIT source, github.com/thlytras/rspiro/data-raw/NHtb45.csv). 30yr 175cm M → FEV1=4.33L, FVC=5.29L, PEF=10.01L/s, ratio=0.82 (all textbook healthy).
- [x] `client/src/audio/recorder.js`, MediaRecorder + iOS AudioContext unlock (`unlockAudio()` called on direct user tap only)
- [x] `client/src/audio/features.js`, rectified+low-pass envelope, radix-2 FFT, 5 features (peakEnv, peakTimeSec, rmsEnergy, tauSec, formantHz, durationSec)
- [x] `client/src/audio/regression.js`, demo-grade estimator with warning comment + sanity-check wrapper (FEV1∈[0.5,8], FVC≥FEV1, ratio∈[0.5,1], fallback to predicted on fail)
- [x] `client/src/views/ParticipantView.jsx`, TAP TO BLOW button, 6-sec countdown, results card with FEV1/FVC/PEF + %-predicted + weak/normal/strong badge, fixed-bottom disclaimer
- [x] Vite build: 35 modules, 155kB bundle, 391ms. Cross-workspace `shared/` import resolves.
- [ ] **User-side:** blow into phone via ngrok HTTPS, verify weak→low%, strong→high%.
- [ ] **User-side:** coefficient swap-in verified via sanity values above.

### Ethnicity decision (locked)
- Using Caucasian Hankinson NHANES III as universal baseline for mixed London audience.
- Single-line disclosure appears on-screen and will be in the GP letter: "NHANES III does not include South or East Asian cohorts; percent-predicted is indicative only."
- Age window: 20–80 (the paper's adult range). Under-20 equations exist but are Phase-4 polish.
### Phase 2: GLM integration + on-device UX, COMPLETE (2026-04-18) ✅
- [x] `shared/reference-equations.js`, 3-ethnicity Hankinson coefficients + 7-option ethnicity routing (Caucasian, African American, Hispanic/Latino, South Asian, East Asian, Black non-AA, Mixed/Other). Non-Hankinson ethnicities route to Caucasian baseline with explicit disclosure.
- [x] `server/prompts.js`, 3 system prompts (EFFORT_CLASSIFIER, PERSONAL_REPORT, GP_LETTER) + message builders that inject numbers rather than let LLM invent them.
- [x] `server/index.js`, `POST /api/analyze-blow` endpoint. Rule-based classifier (instant), then sequential PERSONAL_REPORT + GP_LETTER GLM calls with 3-attempt retry+backoff.
- [x] `server/glm-service.js`, `thinking: {type: "disabled"}` default for all GLM calls (Z.ai-specific escape valve documented in brief; necessary for <30s total latency).
- [x] `client/src/api.js`, fetch wrapper with 1 retry on network errors, 35s timeout.
- [x] `client/src/views/OnboardingView.jsx`, form with name/age/sex/height/ethnicity/consent, mobile-first, validated on submit.
- [x] `client/src/views/ResultsView.jsx`, numbers card, Personal Report card, collapsible GP Letter with massive "Copy to Clipboard" button using `navigator.clipboard.writeText`. `CoachingCard` for invalid blows with retry.
- [x] `client/src/views/ParticipantView.jsx`, router for onboarding → blow → analyzing → results/coaching.
- [x] Vite build green: 38 modules, 170kB bundle, 344ms.
- [x] Endpoint smoke-tested: valid blow → 19s end-to-end, real GLM output for report + letter. Invalid blow → 2ms coaching response.

### Phase 2 notes / deltas from brief
- **LLM classifier dropped from hot path.** Rule-based classifier is instant (2ms) vs 8-15s for GLM classifier with no accuracy benefit at this scale. `EFFORT_CLASSIFIER_SYSTEM` prompt retained in prompts.js for optional future use.
- **Sequential, not parallel, report + letter.** Z.ai 429-rate-limits when 3+ calls fire within ~1s. Sequential with 3-retry backoff (800ms, 1600ms) is more reliable than parallel.
- **`thinking: {type: "disabled"}`**, Z.ai-specific param, approved via brief's "stop and ask on GLM-specific params" escape valve. Without it each GLM call is 30-60s of hidden reasoning tokens and triggers 429s. With it, calls are 8-14s and stable.
- **DNS flakiness.** User's machine intermittently fails to resolve `api.z.ai` (Windows curl fails, Node OS resolver and nslookup work). Fallback templates kick in when connections fail, so demo still produces output even if GLM is unreachable.
### Phase 3: WebSocket aggregation + projector, COMPLETE (2026-04-18) ✅
- [x] `server/prompts.js`, NARRATOR_SYSTEM prompt + `buildNarratorUserMessage` helper.
- [x] `server/index.js`, in-memory room state (`participantCount`, `totalLiters`, `percentPredictedSum`, `flaggedCount`, `newestBlowPct`, `narratorLog`). `goalLiters = max(300, n * 3.5)`.
- [x] `/api/analyze-blow` updates room state + broadcasts `{type:"blow", blow, state}` to projector sockets BEFORE running LLM calls (projector updates within ms, not after 20s).
- [x] WS protocol: client sends `{type:"subscribe", role:"projector"}` → server tracks and pushes state/narrator/blow events.
- [x] Narrator loop every 6s, skips when no participants OR no projector listeners (saves tokens).
- [x] `DEMO_MODE=true` seeds 30 synthetic blows at startup (age-distributed FEV1, pct draws ~N(95, 14)).
- [x] `client/src/App.jsx`, pathname router (`/projector` → ProjectorView, else → ParticipantView).
- [x] `client/src/views/ProjectorView.jsx`, full projector view. Big progress bar X.X / Y.Y L, gradient background shifts by band (early/mid/hot/victory), participant + flagged + mean-%predicted stats, live narrator panel with rolling last-5 log, auto-reconnecting WebSocket.
- [x] End-to-end test (`server/test-projector-ws.js`): projector subscribes, POSTs valid blow, receives initial state + blow broadcast + narrator line within 14s window. All 4 events fired on first run.

### SpiroSmart coefficient investigation (2026-04-18)
- Research agent confirmed SpiroSmart/SpiroCall trained regression weights are **not publicly obtainable**: never in paper/supplementary, Senosis Health acquired by Google/Alphabet 2017 (proprietary since), no GitHub reproductions.
- Paths: email authors (not hackathon-realistic), train our own (no labeled data), OR stick with Hankinson + heuristic + ATS 2019 quality checks.
- Decision: stay with current architecture; add ATS checks as the next accuracy upgrade.
### Phase 4: Polish, fallbacks, demo mode, PENDING

## Known issues

- iOS Safari requires a direct user tap to unlock `AudioContext`, Phase 1 must handle this explicitly.
- GLM-5.1 is a reasoning model by default. We accept the latency since tokens are unlimited per user directive.

## Demo-day run book

TBD after Phase 4.
