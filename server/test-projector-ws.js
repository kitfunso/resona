// One-shot end-to-end test for Phase 3:
//  1. Connect to /ws as projector, subscribe.
//  2. POST a valid blow to /api/analyze-blow.
//  3. Expect: initial 'state' message, then 'blow' broadcast, then at least one
//     'narrator' broadcast within ~12s.
//
// Exits 0 on full success, 1 on any failure.

import WebSocket from 'ws';

const BASE = process.env.TEST_BASE || 'http://localhost:3030';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

const events = [];
let gotHello = false;
let gotInitialState = false;
let gotBlow = false;
let gotNarrator = false;

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log(`[ws] open ${WS_URL}`);
  ws.send(JSON.stringify({ type: 'subscribe', role: 'projector' }));
});

ws.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  events.push({ ts: new Date().toISOString(), ...msg });
  if (msg.type === 'hello') gotHello = true;
  if (msg.type === 'state') {
    gotInitialState = true;
    console.log(`[ws] state participants=${msg.state?.participantCount} totalL=${msg.state?.totalLiters?.toFixed?.(1)}`);
  }
  if (msg.type === 'blow') {
    gotBlow = true;
    console.log(`[ws] BLOW broadcast: pct=${msg.blow?.pct} flagged=${msg.blow?.flagged} participants=${msg.state?.participantCount} totalL=${msg.state?.totalLiters?.toFixed?.(1)}`);
  }
  if (msg.type === 'narrator') {
    gotNarrator = true;
    console.log(`[ws] NARRATOR: "${msg.line}"`);
  }
});

ws.on('error', (err) => {
  console.error(`[ws] error: ${err.message}`);
});

await new Promise((r) => setTimeout(r, 600));

const blowPayload = {
  demographics: { name: 'Keith', ageYears: 30, sex: 'male', heightCm: 175, ethnicity: 'caucasian' },
  features: {
    peakEnv: 1.5, rmsEnergy: 0.5,
    activeSec05: 4.5, activeSec10: 4.1, activeSec20: 3.4, activeSec50: 1.5,
    tauSec: 1.8, formantHz: 100, durationSec: 6.01, sampleRate: 48000,
  },
  estimate: {
    fev1: 4.33, fvc: 5.29, pef: 10.01, fev1FvcRatio: 0.82,
    predicted: { fev1: 4.33, fvc: 5.29, pef: 10.01 },
    percentPredicted: { fev1: 100, fvc: 100, pef: 100 },
    effortScore: 0,
    sanity: { ok: true }, sanityFallback: false,
    referenceStatus: 'hankinson-1999-caucasian',
    referenceNote: 'ok', ethnicityDirectMatch: true,
  },
};

console.log('[http] POST /api/analyze-blow ...');
const t0 = Date.now();
try {
  const res = await fetch(`${BASE}/api/analyze-blow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(blowPayload),
  });
  const body = await res.json();
  console.log(`[http] status=${res.status} valid=${body.valid} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[http] personalReport.source=${body.personalReport?.source} gpLetterSource=${body.gpLetterSource}`);
} catch (err) {
  console.log(`[http] fetch failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}. Continuing to listen for WS events.`);
}

// Wait up to 14s for narrator tick
console.log('[wait] giving narrator loop 14s to fire...');
await new Promise((r) => setTimeout(r, 14000));

const ok = gotHello && gotInitialState && gotBlow && gotNarrator;
console.log('---');
console.log(`gotHello=${gotHello}  gotInitialState=${gotInitialState}  gotBlow=${gotBlow}  gotNarrator=${gotNarrator}`);
console.log(`events: ${events.length} total`);
ws.close();
process.exit(ok ? 0 : 1);
