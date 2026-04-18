# Not-a-Doctor

> Not a doctor. Just a phone that listens.

A single-page web app that turns any smartphone browser into an acoustic spirometer. Built for the Watcha Global AI Hackathon 2026, London.

Users scan a QR code, blow hard into their phone for 6 seconds, and receive an on-device estimate of FEV1, FVC, PEF, and percent-predicted values against Hankinson NHANES III reference equations. Every valid blow adds to a live "Co-Op Boss Fight" projector leaderboard with GLM-powered narration.

**This is a screening tool, not a medical diagnosis.**

## Stack

- Backend: Node.js + Express + WebSocket (`ws`) + ephemeral SQLite (`better-sqlite3`)
- Frontend: React 18 + Vite 5
- LLM: GLM-5.1 via Z.ai, OpenAI SDK compatible
- No raw audio leaves the browser. Only extracted numerical features hit the server.

## Run locally

```bash
# 1. install dependencies (root workspaces)
npm install

# 2. copy env and fill your Z.ai API key
cp .env.example .env
# edit .env, set GLM_API_KEY

# 3. verify the GLM endpoint
npm run test:glm
# expect: Not-a-Doctor GLM check: READY

# 4. run backend + frontend together
npm run dev
# backend: http://localhost:3030 (health at /health)
# frontend: http://localhost:5174

# 5. expose over HTTPS for iOS mic access
# (separate terminal)
ngrok http 5174
```

## Scripts

- `npm run test:glm`, standalone GLM connectivity check
- `npm run dev`, backend + frontend in parallel
- `npm run dev:server`, backend only
- `npm run dev:client`, frontend only

## Layout

```
resona/
├── server/       Express + WebSocket + SQLite
├── client/       React + Vite
├── shared/       Reference equations (NHANES III)
├── deck/         Pitch deck (HTML slides)
└── scratchpad.md project state, updated each phase
```
