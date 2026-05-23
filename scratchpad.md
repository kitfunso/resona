# Resona scratchpad

Read this at the start of every new session. Update at the end of every phase.

## Product

- Name: Resona (codename: not-a-doctor)
- Tagline: "Every body has a rhythm."
- Origin: built for Watcha Global AI Hackathon 2026 (London, 18-19 April). Hackathon now over.
- Current stage: post-hackathon, pivoting toward a real product. Engineering work paused pending product-thesis decisions (see "Product direction" below).
- Surface today: phone web app (`/`) + projector view (`/projector`). Three modalities, all in-browser feature extraction. Single global room, ephemeral state.

## Product direction (open questions, 2026-05-12)

Hackathon is shipped. Before the next sprint we need to lock answers to:

- **Who is the buyer.** Team leads adding wellness to a Monday standup? HR ordering an annual checkup? Employee-side wellness apps? Different buyers = different product.
- **The wedge.** Which of the three modalities is the hook that gets a first team using this on day one? (Best guess: Breath, because it's the most differentiated and the easiest to explain. Motion and Heart are more sensitive but more familiar in form factor.)
- **Single-team vs network.** Does the projector / leaderboard story survive without the demo-day moment? Is there a repeated weekly cadence that holds?
- **Trust model.** "Screening, not diagnosis" was fine for a hackathon. A real product needs an explicit boundary between wellness signal and medical claim, and probably a regulator-aware framing of what we will and will not say.
- **Inference path.** Codex via the developer's ChatGPT OAuth is a hack. Real product needs either server-side LLM credentials with proper rate limiting, smaller on-device models, or rule-based reports with LLM as an optional layer.

Recommended next move: a structured product-thesis session before any more engineering. /office-hours or /brainstorming are the right vehicles.

## Pinned decisions

- LLM model: `gpt-5.4` via Codex (ChatGPT OAuth), default reasoning `medium`, `max_tokens: 2000`. Narrator drops reasoning to `low` to keep latency sub-6s.
- Endpoint: `https://chatgpt.com/backend-api/codex/responses` (streaming responses API).
- Auth: `~/.codex/auth.json`, populated by `npx @openai/codex login`. Token refresh handled by `@mariozechner/pi-ai`. No API key in env.
- SQLite: in-memory only (`:memory:`). Ephemeral. Dies on restart.
- No email. No raw audio upload. No raw video. Three modalities: acoustic spirometry (Breath), accelerometer (Motion), rPPG via per-frame RGB ROI means (Heart).
- HTTPS via ngrok for iOS mic / motion / camera access. No SSL provisioning in code.

## Pinned dependency versions (exact, no ^ or ~)

Backend (`server/`):
- express 4.21.2
- ws 8.18.0
- better-sqlite3 12.9.0
- @mariozechner/pi-ai ^0.68.0 (Codex OAuth + streaming client; replaces openai 4.77.0)
- cors 2.8.5
- dotenv 16.4.7

Frontend (`client/`):
- react 18.3.1
- react-dom 18.3.1
- vite 5.4.11
- @vitejs/plugin-react 4.3.4
- @mediapipe/tasks-vision 0.10.21 (Module 03 face detect; wasm served from node_modules)
- qrcode.react 4.1.0

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

### Phase 5.1: Module 03 review-pass tightenings, COMPLETE (2026-05-12) ✅

Pre-demo hardening from the post-merge review of Module 03. All four landed on `main` in PR #1 (squashed):

- [x] `'unknown'` grade no longer leaks "within typical range" copy: explicit `heartReportFallback` branch + `roomSnapshot` / `recordHeart` only count `good`/`fair` toward projector mean / newest HR.
- [x] Projector heart flash gates on `grade === 'poor'` → renders `data-kind="poor"` with "Noisy capture · retake" + "signal too low" instead of a bogus bpm.
- [x] `AbortSignal` plumbed through `captureRppg`; `HeartView` aborts on unmount + `mountedRef` guards every `setState` after an `await`. No orphan rAF, no setState-on-unmounted.
- [x] MediaPipe wasm served locally via inline vite plugin (dev middleware + build-time copy from `node_modules/@mediapipe/tasks-vision/wasm/`). No jsdelivr CDN dependency at demo time.
- [x] HTTP/WS smoke test passed: `/api/analyze-heart` good / poor / unknown branches behave; mean HR gating verified (poor excluded); WS heart frames carry correct grade + teamCode.

### Phase A: Demo teardown, COMPLETE (2026-05-13) ✅

Removed in preparation for the corporate-product pivot:

- [x] ProjectorView + `/projector` route + WebSocket server + `broadcastToProjectors`.
- [x] Room aggregate state, `roomSnapshot`, `recordBlow`/`recordHeart` tracking, narrator loop, `NARRATOR_SYSTEM` prompt.
- [x] `teamCode` threading from every analyze endpoint and client view.
- [x] `DEMO_MODE` env flag + `seedDemoMode` function.
- [x] GP Letter feature (prompt, server generation, ResultsView card).
- [x] `/api/admin/reset` endpoint.
- [x] `ws` dependency dropped from `server/package.json`.

Codebase is now just the three participant-side biosignal flows + LLM-backed personal reports. Ready for corporate foundations (Phase B).

### Phase B: Corporate foundations, COMPLETE (2026-05-13) ✅

Backbone for a real product. Demo-flavoured paths removed in Phase A; Phase B replaces them with a credentialed, multi-tenant backend.

- [x] OPENAI_API_KEY replaces `~/.codex/auth.json` reading. `server/glm-service.js` → `server/llm.js`. Default model `gpt-4o` (override via `OPENAI_MODEL`).
- [x] Postgres + `pg` 8.x + migration runner (`server/db.js` + `server/migrations/`). `better-sqlite3` dropped.
- [x] Schema: `orgs`, `users` (org_id FK, globally unique case-insensitive email), `check_ins` (org_id FK, kind ∈ {breath, motion, heart}, jsonb payload, indexed by user+created_at and org+created_at), `auth_codes`.
- [x] Magic-code auth: 6-digit code, 10-min TTL, bcrypt-hashed at rest, single-use. `/api/auth/request` is idempotent and leaks no info about which emails exist. `/api/auth/verify` issues an HS256 JWT in an httpOnly cookie.
- [x] Auth middleware + `/api/me` GET/PATCH for profile.
- [x] Admin bootstrap endpoints (`/api/admin/orgs`, `/api/admin/users`) gated by `ADMIN_TOKEN` env.
- [x] All three analyze endpoints (blow / neuro / heart) require a session, source demographics from the authenticated user, and persist results to `check_ins`.
- [x] Client: `LoginView` + session bootstrap in `App.jsx` + `client/src/auth.js`. `OnboardingView` renamed to `ProfileSetupView` and gated to first-time-only.
- [x] Security hardening: rate limits (auth + admin), `LLM_TRACE` gate + PII redactor, timing-safe `ADMIN_TOKEN` compare with boot length check, CORS origin allowlist, `auth_codes` GC, `dob` real-date validator, `sex`/`ethnicity` server-side allowlists.

What's intentionally NOT in this phase: admin/HR dashboard, time-series trend UI, anonymized team aggregates, SSO, real email sender (Resend / Mailgun / SES integration), production deploy (Fly / Render config), DPA / privacy policy text. Those land in the next plan.

### Admin-dashboard Phase A: data model + bootstrap endpoints, COMPLETE (2026-05-23) ✅

Schema + admin-token bootstrap for the org-admin surface. The aggregate read API (admin-dashboard Phase B), the dashboard UI (Phase C), and the employee history view (Phase D) ship as separate episodes.

- [x] `server/migrations/003_admin.sql`: `role` on users (CHECK member|admin, default member); `teams` (org_id FK CASCADE, name CHECK + UNIQUE(org_id, lower(name)), UNIQUE(id, org_id)); `team_memberships` (denormalised org_id + composite FKs to users(id, org_id) and teams(id, org_id), so cross-org rows are unrepresentable at the schema, not just the handler); `role_grants` audit table (CHECK-constrained granted_by accepts 'admin_token' or 'session:%').
- [x] `server/middleware-auth.js`: `loadCurrentUser` now selects `users.role`; flows through `/api/me` automatically.
- [x] `server/index.js`: POST `/api/admin/users/:id/role` (UUID-pre-validated, atomic UPDATE + role_grants INSERT, console.info audit line); POST `/api/admin/teams` (orgSlug -> id, 23505 -> 409 on duplicate name); POST `/api/admin/teams/:id/members` (UUID-pre-validated, handler cross-org check + 23503 -> 400 defence-in-depth, 23P01 deliberately not caught). All gated by adminLimiter + requireAdmin.
- [x] `server/test-admin-schema.js`: 17 `information_schema` assertions including the CASCADE `delete_rule` on every new FK (Article 17 / right-to-erasure path).
- [x] `server/test-admin-endpoints.js`: 15 node --test integration tests against real PG, including the schema-level cross-org INSERT regression (asserts PG code `23503`) and 22P02 -> 400 regressions for malformed UUIDs.
- Built via /dev-framework-rl episode 01KSA2C6YSMSFFDE0X37PZ3EK0. plan-eng-critic round 1 FAIL 58 surfaced a cross-org leak the original draft permitted at the schema; revised PASS 84. code-review PASS 88. independent-review PASS 86 (one med 22P02 -> 400 fixed at root + regression tests added).

What's intentionally NOT in this phase: aggregate read API + min-N suppression (admin-dashboard Phase B), admin dashboard UI (Phase C), employee history view (Phase D), self-service org-admin onboarding (deferred per plan).

### Next plan (TBD)

Admin-dashboard Phase B: the privacy-critical aggregate read API with min-N=5 suppression, org-scoped reads, and `requireOrgAdmin` session middleware. Phase A's `role_grants` audit table and composite-FK tenant isolation are the foundation Phase B reads on top of.

## Known issues

- iOS Safari requires a direct user tap to unlock `AudioContext`, Phase 1 must handle this explicitly.
- Codex `gpt-5.4` defaults to reasoning `medium`. We accept the latency for personal report / heart report / GP letter; narrator overrides to `low` to keep live commentary under 6 seconds.
- Phase 5 user-side rehearsal (real-phone HR within ±10 bpm of a Polar / pulse-ox baseline, dim-light grading, projector heart flash) is still pending; no synthetic substitute.

## Post-hackathon backlog

The hackathon demo-day run book is no longer relevant. Items still parked for whenever the product direction is locked:

- Phase 1 user-side: confirm weak/strong blow scoring on a real phone via ngrok HTTPS (never repeated after the calibration journey, still technically open).
- Phase 5 user-side: real-phone HR within ±10 bpm of a Polar / pulse-ox baseline; dim-light grading; projector heart flash verified live.
- Phase 4 polish + fallback work: never started. Mostly meaningless until the product wedge is chosen — what counts as "polish" depends on which surface we keep.
