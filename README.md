# Resona

> Every body has a rhythm.

Resona is a self-experimentation tool for the quantified-self curious. It turns a phone you already own into a quick three-signal sensor pass: breath, motion, and (with the heart module) camera-based pulse, all extracted on-device.

**This is screening-grade self-exploration. It is not a medical device, not a diagnosis tool, and not clinical advice.** The numbers are for personal curiosity; if anything stands out to you, the right next step is a conversation with your GP, and Resona generates a short list of questions you can take to that conversation. There is no medical claim here.

It originated as a live demo for the Watcha Global AI Hackathon 2026 in London (scan a QR code, complete the sensor pass on your own phone, see a shared projector view), and that demo flow still works.

## What Resona does

Resona is built around a simple idea: most workplace wellness products ask people to wear hardware they do not want, trust dashboards they never open, or hand over raw personal data they should not have to share.

Resona uses the sensors already on the phone.

Current product shape:

- **Breath module, live.** A 6-second forced exhalation into the phone microphone estimates FEV1, FVC, PEF, percent-predicted, and basic effort-quality flags.
- **Motion module, prototype.** A phone-based neuro screen captures stillness tremor and short-walk gait signals from the accelerometer.
- **Projector mode, live.** Team totals update over WebSockets so a room can run a shared check-in or hackathon-style demo.
- **LLM-generated output, live.** The backend turns extracted features into a personal report, a GP-letter draft, and projector narration.

**Important:** this is a screening demo, not a medical device and not a diagnosis tool.

## Why it exists

The original demo brief was a live, low-friction, privacy-aware health check for teams.

The resulting product thesis is still sharp:

- no wearables
- no app install
- no raw sensor uploads
- fast enough to use in a room full of people
- useful both for the individual and for a shared team moment

## How it works

### 1. Onboarding
Participants enter a few demographic fields needed for percent-predicted spirometry and give consent.

### 2. Breath capture
The browser records a short forced exhalation, extracts features on-device, and estimates demo-grade spirometry outputs.

### 3. Analysis
The client sends extracted numerical features to the backend. The backend returns:

- screening numbers
- personal report
- GP letter draft
- coaching feedback for weak or invalid blows

### 4. Live room update
Each valid blow updates the room state. The projector view shows:

- total litres achieved
- room progress toward the shared goal
- mean percent-predicted
- top teams
- rolling narrator commentary

## Privacy model

This is one of the strongest parts of the project.

- Raw audio is processed in the browser.
- Motion signals are processed in the browser.
- No raw audio, no raw video, and no GPS are sent to the server.
- The server receives extracted features and aggregate results only.
- Room state is ephemeral.
- SQLite runs in memory only and clears on restart.

If you care about privacy-preserving screening flows, this is the bit worth stealing.

## Current architecture

### Frontend
- React 18
- Vite 5
- Mobile-first participant flow
- Dedicated projector route at `/projector`

### Backend
- Node.js
- Express
- WebSocket server via `ws`
- Ephemeral SQLite via `better-sqlite3`

### LLM layer
Resona uses **GPT-5.4 via Codex OAuth** and reads auth from `~/.codex/auth.json`. The service lives in `server/gpt-service.js`.

Reporting/analysis paths (`neuro-report`, `personal-report`, `gp-letter`) run with `reasoning: 'xhigh'` + priority service tier (`fastMode: true`) so the clinical output is high-fidelity without queue latency. The live narrator stays on `reasoning: 'low'` to fit inside the 6-second tick.

That means you need to log in once with Codex locally before the app can call GPT.

## Repository layout

```text
resona/
├── client/        React + Vite frontend
├── server/        Express + WebSocket backend
├── shared/        Shared screening/reference logic
├── deck/          Pitch deck assets
├── mockups/       Visual exploration
├── scripts/       Utility scripts
├── submission/    Hackathon submission assets
├── PITCH.md       2-minute pitch outline
├── scratchpad.md  Live build notes and phase history
└── README.md
```

## Local setup

### Requirements

- Node.js 20+
- npm
- A logged-in Codex environment
- HTTPS tunnel for iPhone mic and motion permissions during real-device testing

### 1. Install dependencies

```bash
npm install
```

### 2. Set environment variables

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Default env:

```env
PORT=3030
DEMO_MODE=false
```

### 3. Log into Codex

```bash
npx @openai/codex login
```

Auth is read from:

```text
~/.codex/auth.json
```

### 4. Verify the LLM path

```bash
npm run test:gpt
```

### 5. Run the app

```bash
npm run dev
```

Expected local endpoints:

- frontend: `http://localhost:5174`
- backend: `http://localhost:3030`
- health: `http://localhost:3030/health`
- projector: `http://localhost:5174/projector`

### 6. Expose over HTTPS for phone sensors

```bash
ngrok http 5174
```

Use the HTTPS ngrok URL on the phone. iOS Safari will not reliably grant microphone or motion access on plain HTTP.

## Available scripts

At the repo root:

```bash
npm run dev
npm run dev:server
npm run dev:client
npm run test:gpt
```

## Core routes and endpoints

### Frontend routes
- `/` participant flow
- `/projector` live room display

### Backend endpoints
- `GET /health` health and room snapshot
- `POST /api/analyze-blow` breath analysis flow
- `POST /api/analyze-neuro` motion / neuro analysis flow
- WebSocket subscription for projector clients

## Demo mode

Set:

```env
DEMO_MODE=true
```

This seeds synthetic room data on startup so the projector is not empty before a live demo begins.

## Product status

This repo is best understood as a sharp hackathon prototype with real signal-processing work inside it, not a finished medical product.

What is solid:

- participant flow
- projector flow
- ephemeral room aggregation
- privacy model
- live demo mechanics
- breath-screening core

What is still prototype-grade:

- clinical validity
- calibration across devices and environments
- motion-screen interpretation
- operational hardening
- production auth / storage / tenancy

## Limitations

- Breath output is screening-grade, not clinical spirometry.
- Percent-predicted framing depends on demographic inputs and reference-equation assumptions.
- Sensor quality varies by phone, browser, room noise, and user technique.
- The LLM output is useful presentation glue, not medical advice.
- Current persistence is intentionally ephemeral.

## If you are evaluating the idea

The interesting part is not just phone spirometry.

It is the combination of:

- low-friction phone capture
- on-device feature extraction
- privacy-preserving server design
- real-time room aggregation
- instantly legible output for both the individual and the group

That combination is what makes Resona feel different from a generic wellness app.

## Origin

Built for:

- **Watcha Global AI Hackathon 2026**
- London
- 18 to 19 April 2026

Original line:

> Wellness without wearables.

Still a good line, to be fair.
