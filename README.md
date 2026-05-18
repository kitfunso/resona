# Resona

> Every body has a rhythm.

A phone-based 2-minute team wellness check-in. Three biosignal modalities, all processed in the browser.

Employees scan a QR code, spend two minutes on three biosignal checks, and land on the live team projector. Every valid check-in fills a shared goal bar with AI-narrated commentary.

Resona started as a prototype for the Watcha Global AI Hackathon (London, 18-19 April 2026). The hackathon is over; the codebase is now in transition toward a real product. See `scratchpad.md` for current state.

## What it measures

- **Module 01 · Breath.** Acoustic spirometry from a 6-second forced exhalation into the phone microphone. Estimates FEV1, FVC, PEF, and percent-predicted against Hankinson NHANES III reference equations. Adds two ATS 2019 effort-quality flags.
- **Module 02 · Motion.** Tremor from 10-second stillness and gait cadence from a 10-step walk, using the phone's accelerometer (DeviceMotion API) at 60 Hz. FFT-banded into parkinsonian, essential, and physiological ranges.
- **Module 03 · Heart.** rPPG from the front camera. 30-second face-centred capture, MediaPipe Tasks Vision face detect to forehead + cheeks ROIs, POS (Wang 2017) pulse extraction, FFT-derived HR with parabolic interpolation, freq-domain bandpass + peak-detect for RMSSD and SDNN. Quality grades (good / fair / poor / unknown) gate the report; poor short-circuits to coaching without showing a number.

**This is a screening tool. Not a medical diagnosis.**

## Privacy

Audio is analysed in the browser. IMU samples are analysed in the browser. Video frames for rPPG (Module 03 Heart) are reduced to per-frame RGB ROI means inside the browser; raw pixels never leave the device. Nothing but extracted numerical features ever touches the server. No raw audio, no video, no GPS.

## Stack

- Backend: Node.js, Express, WebSocket (`ws`), ephemeral SQLite (`better-sqlite3`, `:memory:`)
- Frontend: React 18 + Vite 5
- LLM: Codex (ChatGPT OAuth, default `gpt-5.4`) via `@mariozechner/pi-ai` for personal report, GP letter, heart report, and the live narrator. Auth is the user's `~/.codex/auth.json` (populated by `codex login`); no API key in env.
- Face detect: MediaPipe Tasks Vision (`@mediapipe/tasks-vision`). The wasm runtime is served from `node_modules/` via a small inline vite plugin, so demo-day face detect doesn't depend on the jsdelivr CDN.
- Typography: Instrument Serif, Manrope, JetBrains Mono

## Run locally

```bash
# 1. install workspace dependencies
npm install

# 2. copy env (optional, only for non-default overrides)
cp .env.example .env

# 3. log in to Codex once (writes ~/.codex/auth.json)
npx @openai/codex login

# 4. verify the Codex endpoint
npm run test:glm

# 5. run backend + frontend together
npm run dev
# backend: http://localhost:3030 (health at /health)
# frontend: http://localhost:5174

# 6. expose over HTTPS for iOS mic / motion / camera permissions
# (separate terminal)
ngrok http 5174
```

Once ngrok is up, the projector lives at `/projector` and the participant flow at `/`.

## Scripts

- `npm run test:glm`, standalone Codex connectivity check
- `npm run dev`, backend + frontend in parallel
- `npm run dev:server`, backend only
- `npm run dev:client`, frontend only
- `npm test --workspace=client`, heart-pipeline unit tests (POS, features, regression)

## Layout

```
resona/
├── server/       Express + WebSocket + SQLite (room aggregate state, Codex calls, prompts)
├── client/       React + Vite (participant, results, neuro, heart, projector)
│   └── src/video/   POS, features, regression, recorder, MediaPipe face detect
├── shared/       Hankinson NHANES III reference equations
├── deck/         5-slide editorial pitch deck (static HTML)
├── docs/         Module design specs + implementation plans (under superpowers/)
├── mockups/      Font and style mockups
└── scratchpad.md Working project state
```

## Status

Hackathon prototype, three biosignal pipelines shipped (Breath, Motion, Heart). Demo-day surface (projector view, leaderboard, narrator, GP Letter, DEMO_MODE) has been removed. The codebase is mid-transition toward a corporate product. Next: Postgres + auth + multi-tenant org model (see `docs/superpowers/plans/2026-05-13-corporate-foundations.md`).
