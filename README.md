# Resona

## DevDay London: Resona sensor demo

Today's entry is a phone-based check-in built on our earlier Resona project. Record a comfortable breath sound, take a short walk, and see approximate readings from the phone's microphone and motion sensor. These values describe the recording; they are not validated health measurements or a medical assessment.

Raw sound and motion samples are processed in the browser. If you choose an AI-selected note, the app sends the extracted numerical readings to the demo server and OpenAI. Those readings can still be personal information. OpenAI selects from fixed, non-medical notes rather than writing a diagnosis. The optional note needs a configured server and private demo link; the readings remain visible if it is unavailable.

From the repository root, run `npm ci`, then `npm run dev:client` and open `http://localhost:5174/sensor.html`. Microphone and motion permissions are needed for the corresponding captures; phone access requires a secure context such as HTTPS. This frontend command alone does not configure the AI service.

The new sensor flow reuses the original audio and motion processing and Resona's design. Codex helped build the new interface, wire the browser readings to a constrained server-side note, and test the flow. See [submission notes](submission/devday-reset/README.md) for credits, narration and the earlier Reset recordings.

The [Cloudflare sensor page](https://resona-devday-sensor.skfsk27.workers.dev/sensor) is deployed for the hackathon. AI notes require the private demo link and have a limited number of attempts. See [Worker setup](tools/sensor-cloud/README.md) for deployment instructions.

The earlier Resona Reset prototype remains at `/reset.html`. Its recordings and [build evidence](docs/devday-reset.html) describe that prototype, not the new sensor demo.

## Earlier Resona product

The sections below document the original authenticated product and its separate server and database. They do not describe the scope of today's demo.

> Every body has a rhythm.

A phone-based 2-minute team wellness check-in. Three biosignal modalities, all processed in the browser.

Employees sign in with their work email, spend two minutes on three biosignal checks, and get a personalised report. Check-ins are saved to their account so trends can build over time.

Resona started as a prototype for the Watcha Global AI Hackathon (London, 18-19 April 2026) and is now being built out as a corporate wellness product. See `scratchpad.md` for current state.

## What it measures

- **Module 01 · Breath.** Acoustic spirometry from a 6-second forced exhalation into the phone microphone. Estimates FEV1, FVC, PEF, and percent-predicted against Hankinson NHANES III reference equations. Adds two ATS 2019 effort-quality flags.
- **Module 02 · Motion.** Tremor from 10-second stillness and gait cadence from a 10-step walk, using the phone's accelerometer (DeviceMotion API) at 60 Hz. FFT-banded into parkinsonian, essential, and physiological ranges.
- **Module 03 · Heart.** rPPG from the front camera. 30-second face-centred capture, MediaPipe Tasks Vision face detect to forehead + cheeks ROIs, POS (Wang 2017) pulse extraction, FFT-derived HR with parabolic interpolation, freq-domain bandpass + peak-detect for RMSSD and SDNN. Quality grades (good / fair / poor / unknown) gate the report; poor short-circuits to coaching without showing a number.

**This is a screening tool. Not a medical diagnosis.**

## Privacy

Audio is analysed in the browser. IMU samples are analysed in the browser. Video frames for rPPG (Module 03 Heart) are reduced to per-frame RGB ROI means inside the browser; raw pixels never leave the device. Nothing but extracted numerical features ever touches the server. No raw audio, no video, no GPS.

## Stack

- Backend: Node.js, Express, Postgres (`pg`), JWT sessions (`jose`), OpenAI SDK
- Frontend: React 18 + Vite 5
- Auth: passwordless magic-code via email (6-digit code, 10-min TTL, single-use)
- LLM: OpenAI API (default `gpt-4o`, overridable via `OPENAI_MODEL`)
- Face detect: MediaPipe Tasks Vision (`@mediapipe/tasks-vision`), wasm served from `node_modules/`
- Typography: Instrument Serif, Manrope, JetBrains Mono

## Run locally

```bash
# 1. install workspace dependencies
npm install

# 2. provision a local Postgres database
createdb resona_dev

# 3. copy env and fill in the four required values
cp .env.example .env
# edit .env:
#   OPENAI_API_KEY=sk-...
#   DATABASE_URL=postgres:///resona_dev
#   SESSION_SECRET=$(openssl rand -base64 48 | tr -d '=\n')
#   ADMIN_TOKEN=$(openssl rand -base64 32 | tr -d '=\n')

# 4. boot the server (runs migrations automatically on startup)
npm run dev:server

# 5. bootstrap your first org + user (in another terminal)
curl -X POST http://localhost:3030/api/admin/orgs \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $(grep ADMIN_TOKEN .env | cut -d= -f2)" \
  -d '{"slug":"demo","name":"Demo Co","firstUserEmail":"you@example.com"}'

# 6. boot the frontend
npm run dev:client
# open http://localhost:5174, sign in with your email
# the magic-code is logged to the server console + dev-emails/log.json
```

## Scripts

- `npm run test:llm`, standalone OpenAI connectivity check
- `npm test`, server test suite (db, schema, email, auth, HTTP integration)
- `npm run dev`, backend + frontend in parallel
- `npm run dev:server`, backend only
- `npm run dev:client`, frontend only
- `npm test --workspace=client`, heart-pipeline unit tests (POS, features, regression)

## Layout

```
resona/
├── server/       Express + Postgres (migrations, magic-code auth, OpenAI calls, prompts)
├── client/       React + Vite (login, profile setup, participant, results, neuro, heart)
│   └── src/video/   POS, features, regression, recorder, MediaPipe face detect
├── shared/       Hankinson NHANES III reference equations
├── deck/         5-slide editorial pitch deck (static HTML)
├── docs/         Module design specs + implementation plans (under superpowers/)
├── mockups/      Font and style mockups
└── scratchpad.md Working project state
```

## Status

Corporate foundations shipped: Postgres persistence, passwordless magic-code auth with JWT sessions, a multi-tenant org model, and per-user check-in history. The three biosignal pipelines (Breath, Motion, Heart) are intact; the demo-day surface (projector, leaderboard, narrator, GP Letter, DEMO_MODE) has been removed. See `docs/superpowers/plans/2026-05-13-corporate-foundations.md`.

Still ahead before this is a shippable product: the admin/HR-facing dashboard, a hosted backend (HTTPS, secrets, observability), and a written privacy policy + DPA to go with the existing medical-device disclaimer.
