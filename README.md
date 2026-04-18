# Resona at Work

> Every body has a rhythm.

A phone-based 2-minute team wellness check-in. Built for the Watcha Global AI Hackathon 2026, London, 18-19 April.

Employees scan a QR code, spend two minutes on two biosignal checks, and land on the live team projector. Every valid check-in fills a shared goal bar with GLM-powered narration.

## What it measures

- **Module 01 · Breath.** Acoustic spirometry from a 6-second forced exhalation into the phone microphone. Estimates FEV1, FVC, PEF, and percent-predicted against Hankinson NHANES III reference equations. Adds two ATS 2019 effort-quality flags.
- **Module 02 · Motion.** Tremor from 10-second stillness and gait cadence from a 10-step walk, using the phone's accelerometer (DeviceMotion API) at 60 Hz. FFT-banded into parkinsonian, essential, and physiological ranges.
- **Module 03 · Heart.** rPPG from the front camera, roadmapped for Q3 2026.

**This is a screening tool. Not a medical diagnosis.**

## Privacy

Audio is analysed in the browser. IMU samples are analysed in the browser. Nothing but extracted numerical features ever touches the server. No raw audio, no video, no GPS.

## Stack

- Backend: Node.js, Express, WebSocket (`ws`), ephemeral SQLite (`better-sqlite3`, `:memory:`)
- Frontend: React 18 + Vite 5
- LLM: GLM-5.1 via Z.ai (OpenAI SDK compatible) for personal report, GP letter, and the live narrator
- Typography: Instrument Serif, Manrope, JetBrains Mono

## Run locally

```bash
# 1. install workspace dependencies
npm install

# 2. copy env and fill your Z.ai API key
cp .env.example .env
# edit .env, set GLM_API_KEY

# 3. verify the GLM endpoint
npm run test:glm

# 4. run backend + frontend together
npm run dev
# backend: http://localhost:3030 (health at /health)
# frontend: http://localhost:5174

# 5. expose over HTTPS for iOS mic / motion permissions
# (separate terminal)
ngrok http 5174
```

Once ngrok is up, the projector lives at `/projector` and the participant flow at `/`.

## Scripts

- `npm run test:glm`, standalone GLM connectivity check
- `npm run dev`, backend + frontend in parallel
- `npm run dev:server`, backend only
- `npm run dev:client`, frontend only

## Layout

```
resona/
├── server/       Express + WebSocket + SQLite (room aggregate state)
├── client/       React + Vite (participant, results, neuro, projector)
├── shared/       Hankinson NHANES III reference equations
├── deck/         5-slide editorial pitch deck (static HTML)
├── mockups/      Font and style mockups
└── scratchpad.md Working project state
```

## Pitch day

Live demo at Watcha London, 19 April 2026. Audience scans the projector QR, blows into their phones, and fills a 300 litre team goal bar with the narrator calling plays in real time.
