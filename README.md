# Resona

## DevDay London: original Resona

The DevDay work continues the original Resona app described below. The updated app is deployed at [resona-devday-original-2026.pages.dev](https://resona-devday-original-2026.pages.dev/); guest sign-in requires the private demo link shared separately. The earlier live app at [resona-dmf.pages.dev](https://resona-dmf.pages.dev/) still shows older, unvalidated health estimates; do not use them for medical decisions.

The update preserves the existing breath, motion and heart screens and removes unsupported claims. Before recording, a participant can opt in to automatic Codex model reports. After a capture, the app sends derived numerical readings to OpenAI, and the model selects a recording tip from fixed, non-medical options. Without opt-in, readings stay local. Raw recordings stay on the device. Successful reports and their readings are saved with the guest account. See [Codex analytics details](tools/sensor-cloud/CODEX-ANALYSIS.md), the [updated slides](submission/Resona-DevDay-rebuilt.pptx) and [demo script](submission/Resona-DevDay-script.md).

The rebuilt slides preserve the original pitch text by request. Its historical health claims, model references and demo link do not describe the current app; use the current demo script for the present implementation.

To run the Pages demo locally, install dependencies with `npm ci` and build with `npm run build --workspace=client`. Set `SESSION_SECRET` and a random `DEMO_ACCESS_TOKEN` of at least 32 URL-safe characters in your shell. Then run:

```sh
npx wrangler d1 execute resona --local --file schema.sql --persist-to .wrangler/demo-data
npx wrangler pages dev client/dist --persist-to .wrangler/demo-data --binding SESSION_SECRET=$SESSION_SECRET --binding DEMO_ACCESS_TOKEN=$DEMO_ACCESS_TOKEN
```

Open the local address with `#demo=` followed by your demo access token, then choose the guest button. Keep the token private. The local D1 database is separate from Cloudflare. Phone sensor access requires HTTPS. The separate Express/Postgres instructions further down describe the earlier backend.

## Earlier DevDay sensor experiment

This separate experiment records a breath sound and a short walk. It is not the original Resona app. These values describe the recording; they are not validated health measurements or a medical assessment.

Raw sound and motion samples are processed in the browser. If you choose an AI-selected note, the app sends the extracted numerical readings to the demo server and OpenAI. Those readings can still be personal information. OpenAI selects from fixed, non-medical notes rather than writing a diagnosis. The optional note needs a configured server and private demo link; the readings remain visible if it is unavailable.

From the repository root, run `npm ci`, then `npm run dev:client` and open `http://localhost:5174/sensor.html`. Microphone and motion permissions are needed for the corresponding captures; phone access requires a secure context such as HTTPS. This frontend command alone does not configure the AI service.

The new sensor flow reuses the original audio and motion processing and Resona's design. Codex helped build the new interface, wire the browser readings to a constrained server-side note, and test the flow. See [submission notes](submission/devday-reset/README.md) for credits, narration and the earlier Reset recordings.

The [Cloudflare sensor page](https://resona-devday-sensor.skfsk27.workers.dev/sensor) is a separate experiment. AI notes require the private demo link and have a limited number of attempts. See [Worker setup](tools/sensor-cloud/README.md) for deployment instructions.

The earlier Resona Reset prototype remains at `/reset.html`. Its recordings and [build evidence](docs/devday-reset.html) describe that prototype, not the new sensor demo.

## Earlier Resona product

The sections below document the original authenticated product and its separate server and database. Its older health estimates and medical framing are unvalidated.

> Every body has a rhythm.

A phone-based 2-minute team wellness check-in. Three biosignal modalities, all processed in the browser.

Employees sign in with their work email, spend two minutes on three biosignal checks, and get a personalised report. Check-ins are saved to their account so trends can build over time.

Resona started as a prototype for the Watcha Global AI Hackathon (London, 18-19 April 2026) and is now being built out as a corporate wellness product. See `scratchpad.md` for current state.

## Experimental readings

- **Module 01 · Breath.** Describes the level and duration of a microphone recording.
- **Module 02 · Motion.** Uses the phone's motion sensor to estimate movement frequency and walking cadence.
- **Module 03 · Heart.** Experiments with a camera-based pulse estimate and checks capture quality.

These readings are unvalidated and are not medical screening or a diagnosis.

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
