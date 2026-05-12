import React, { useState } from 'react';
import { requestMotionPermission, captureMotion } from '../imu/motion.js';
import { analyseTremor } from '../imu/tremor.js';
import { analyseGait } from '../imu/gait.js';
import { unlockAudio, getAudioContext } from '../audio/recorder.js';

const css = `
  .nv-stage {
    width: 100%;
    max-width: 30rem;
    display: flex; flex-direction: column;
    gap: var(--s-4);
    margin-top: var(--s-2);
    text-align: left;
  }

  .nv-head {
    display: flex; flex-direction: column; gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .nv-head .eyebrow {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .nv-head .title {
    font-family: var(--font-display);
    
    font-size: 1.8rem;
    line-height: 1;
    color: var(--bone-0);
    margin: 0;
  }
  .nv-head .sub {
    font-size: 0.82rem;
    color: var(--bone-2);
    line-height: 1.55;
    margin: 0;
  }

  /* ========= Test step card ========= */
  .nv-step {
    padding: var(--s-5);
    border: 1px solid var(--hairline);
    background: rgba(26, 28, 38, 0.5);
    border-radius: var(--r-lg);
    display: flex; flex-direction: column; gap: var(--s-3);
    position: relative;
    overflow: hidden;
  }
  .nv-step[data-state="active"] {
    border-color: var(--brass);
    background: rgba(231, 184, 126, 0.06);
    box-shadow: 0 0 0 1px var(--brass-line), 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  .nv-step[data-state="done"] {
    border-color: rgba(123, 193, 150, 0.28);
    background: rgba(123, 193, 150, 0.04);
  }
  .nv-step-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2);
  }
  .nv-step-hd .n {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: 2.4rem;
    line-height: 0.9;
    color: var(--brass);
  }
  .nv-step-hd .t {
    flex: 1;
    text-align: right;
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .nv-step[data-state="done"] .nv-step-hd .t { color: var(--pulse); }
  .nv-step[data-state="active"] .nv-step-hd .t { color: var(--brass); }

  .nv-step-title {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: 1.5rem;
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }
  .nv-step-desc {
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--bone-2);
    margin: 0;
  }
  .nv-step-desc strong { color: var(--bone-0); font-weight: 600; }

  .nv-btn {
    appearance: none; border: none;
    background: var(--bone-0);
    color: var(--ink-0);
    font-family: var(--font-body);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    padding: 1rem var(--s-4);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: box-shadow 0.2s, transform 0.1s;
    display: flex; align-items: center; justify-content: center;
    gap: var(--s-2);
    width: 100%;
  }
  .nv-btn:hover { box-shadow: var(--shadow-brass); }
  .nv-btn:active { transform: scale(0.99); }
  .nv-btn:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
  .nv-btn .arrow {
    font-family: var(--font-display);
    
    font-size: 1.15rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--brass-dim);
  }
  .nv-btn-ghost {
    appearance: none;
    background: transparent;
    border: 1px solid var(--hairline-strong);
    color: var(--bone-2);
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    padding: 0.85rem var(--s-4);
    border-radius: var(--r-sm);
    cursor: pointer;
    width: 100%;
    transition: all 0.15s;
  }
  .nv-btn-ghost:hover { color: var(--bone-0); border-color: var(--bone-2); }

  /* ========= Prep countdown ========= */
  .nv-prep {
    display: flex; flex-direction: column; align-items: center; gap: var(--s-2);
    padding: var(--s-4) 0;
  }
  .nv-prep-lab {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .nv-prep-num {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: 5rem;
    line-height: 0.9;
    color: var(--bone-0);
    text-shadow: 0 0 48px rgba(231, 184, 126, 0.35);
  }
  .nv-prep-hint {
    font-family: var(--font-body);
    font-size: 0.92rem;
    color: var(--bone-1);
    text-align: center;
    max-width: 20rem;
    line-height: 1.45;
  }

  /* ========= Recording countdown ========= */
  .nv-record {
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .nv-record-num {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: 4rem;
    line-height: 0.9;
    text-align: center;
    color: var(--bone-0);
  }
  .nv-record-progress {
    height: 4px;
    background: rgba(244, 236, 225, 0.06);
    border-radius: 2px;
    overflow: hidden;
    position: relative;
  }
  .nv-record-progress::before {
    content: '';
    position: absolute; inset: 0;
    background: repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(10% - 1px),
      rgba(244, 236, 225, 0.12) calc(10% - 1px),
      rgba(244, 236, 225, 0.12) 10%
    );
  }
  .nv-record-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--brass), var(--brass-bright));
    box-shadow: 0 0 12px var(--brass-glow);
    transition: width 0.1s linear;
  }
  .nv-record-cue {
    text-align: center;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--brass);
  }

  /* ========= Result rows ========= */
  .nv-result {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--s-3);
    align-items: baseline;
    padding: var(--s-3) 0;
    border-bottom: 1px dashed var(--hairline);
  }
  .nv-result:last-of-type { border-bottom: none; }
  .nv-result .k {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .nv-result .v {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 1.1rem;
    font-weight: 500;
    color: var(--bone-0);
    letter-spacing: -0.01em;
  }

  .nv-band {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-sm);
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    width: fit-content;
  }
  .nv-band[data-k="physiological"] {
    background: var(--pulse-dim);
    color: var(--pulse-bright);
    border: 1px solid rgba(123, 193, 150, 0.3);
  }
  .nv-band[data-k="essential_like"] {
    background: rgba(231, 184, 126, 0.1);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }
  .nv-band[data-k="parkinsonian_like"] {
    background: var(--warn-dim);
    color: #f0c4c8;
    border: 1px solid rgba(209, 133, 137, 0.35);
  }
  .nv-band .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor; box-shadow: 0 0 8px currentColor;
  }

  /* ========= Neuro report card ========= */
  .nv-report {
    background:
      radial-gradient(ellipse at top right, rgba(168, 85, 247, 0.05), transparent 60%),
      var(--ink-2);
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5);
    display: flex; flex-direction: column; gap: var(--s-4);
  }
  .nv-report-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .nv-report-hd .k {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .nv-report .headline {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: 1.5rem;
    line-height: 1.2;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }
  .nv-report .interp {
    font-family: var(--font-body);
    font-size: 0.92rem;
    line-height: 1.6;
    color: var(--bone-1);
    margin: 0;
  }
  .nv-actions-label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--bone-3);
    display: flex; align-items: center; gap: var(--s-2);
    margin: 0;
  }
  .nv-actions-label::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }
  .nv-actions {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .nv-action {
    display: grid;
    grid-template-columns: 2rem 1fr;
    gap: var(--s-3);
    align-items: start;
    line-height: 1.5;
  }
  .nv-action .num {
    font-family: var(--font-display);
    
    font-size: 1.35rem;
    color: var(--brass);
    line-height: 1;
    margin-top: 0.1rem;
  }
  .nv-action .t {
    display: block; font-weight: 700; font-size: 0.95rem; color: var(--bone-0);
    margin-bottom: 0.2rem;
  }
  .nv-action .d {
    display: block; font-size: 0.85rem; color: var(--bone-2); line-height: 1.5;
  }
  .nv-worry {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s-3);
    padding: var(--s-3);
    background: rgba(231, 184, 126, 0.08);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-sm);
    color: var(--bone-1);
    font-size: 0.85rem; line-height: 1.5;
  }
  .nv-worry .icon {
    font-family: var(--font-display);  font-size: 1.3rem;
    color: var(--brass-bright); line-height: 1;
  }
  .nv-worry .lab {
    display: block; font-size: 0.62rem; font-weight: 700;
    letter-spacing: 0.24em; text-transform: uppercase;
    color: var(--brass-bright); margin-bottom: 0.2rem;
  }
  .nv-analyzing {
    display: flex; flex-direction: column; align-items: center;
    gap: var(--s-4);
    padding: var(--s-6) 0;
  }
  .nv-analyzing-bars {
    display: flex; gap: 5px;
    align-items: flex-end;
    height: 48px;
  }
  .nv-analyzing-bars span {
    display: block;
    width: 4px;
    background: var(--brass);
    border-radius: 1px;
    animation: nv-wave 1.1s ease-in-out infinite;
  }
  .nv-analyzing-bars span:nth-child(1) { animation-delay: 0s; }
  .nv-analyzing-bars span:nth-child(2) { animation-delay: 0.08s; }
  .nv-analyzing-bars span:nth-child(3) { animation-delay: 0.16s; }
  .nv-analyzing-bars span:nth-child(4) { animation-delay: 0.24s; }
  .nv-analyzing-bars span:nth-child(5) { animation-delay: 0.32s; }
  .nv-analyzing-bars span:nth-child(6) { animation-delay: 0.40s; }
  .nv-analyzing-bars span:nth-child(7) { animation-delay: 0.48s; }
  @keyframes nv-wave {
    0%, 100% { height: 8px; opacity: 0.55; }
    50%      { height: 48px; opacity: 1; }
  }
  .nv-analyzing-label {
    font-family: var(--font-display);
    font-size: 1.5rem;
    color: var(--bone-1);
  }
  .nv-analyzing-sub {
    font-size: 0.72rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--bone-3);
  }

  .nv-caveat {
    padding: var(--s-3) var(--s-4);
    background: rgba(244, 236, 225, 0.03);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    font-size: 0.78rem;
    color: var(--bone-2);
    line-height: 1.5;
  }
  .nv-error {
    padding: var(--s-3) var(--s-4);
    background: var(--warn-dim);
    border: 1px solid rgba(209, 133, 137, 0.3);
    color: #f3c7c8;
    border-radius: var(--r-sm);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  /* ========= Volume / silent-mode warning ========= */
  .nv-volwarn {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s-3);
    align-items: center;
    padding: var(--s-3);
    background: rgba(231, 184, 126, 0.06);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-sm);
    font-size: 0.78rem;
    color: var(--bone-1);
    line-height: 1.45;
  }
  .nv-volwarn .ic {
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--brass-bright);
    line-height: 1;
  }
  .nv-volwarn strong { color: var(--bone-0); font-weight: 700; }

  /* ========= Full-card flash overlay (start / end cue) ========= */
  .nv-flash {
    position: absolute;
    inset: 0;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
    z-index: 5;
    animation: nv-flash-in 0.9s ease-out forwards;
  }
  .nv-flash[data-k="go"] {
    background: radial-gradient(circle at center, rgba(123, 193, 150, 0.55), rgba(123, 193, 150, 0.0) 70%);
  }
  .nv-flash[data-k="stop"] {
    background: radial-gradient(circle at center, rgba(209, 133, 137, 0.55), rgba(209, 133, 137, 0.0) 70%);
  }
  .nv-flash .label {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(2.4rem, 11vw, 4.2rem);
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--bone-0);
    text-shadow: 0 0 32px currentColor;
    text-align: center;
    width: 100%;
    padding: 0 var(--s-3);
    box-sizing: border-box;
  }
  .nv-flash[data-k="go"] .label { color: #b8e3c7; }
  .nv-flash[data-k="stop"] .label { color: #f3c7c8; }
  @keyframes nv-flash-in {
    0%   { opacity: 0; transform: scale(0.94); }
    15%  { opacity: 1; transform: scale(1.04); }
    55%  { opacity: 1; transform: scale(1.0); }
    100% { opacity: 0; transform: scale(1.0); }
  }
`;

let cssInjected = false;
function useCss() {
  if (!cssInjected && typeof document !== 'undefined') {
    const tag = document.createElement('style');
    tag.textContent = css;
    document.head.appendChild(tag);
    cssInjected = true;
  }
}

const PREP_SECONDS = 5;

async function prep(seconds, onTick) {
  for (let s = seconds; s > 0; s--) {
    onTick(s);
    await new Promise((r) => setTimeout(r, 1000));
  }
  onTick(0);
}

// Play a short beep on the shared AudioContext. iOS Safari suspends the
// context after a few seconds of silence, so we MUST await resume() before
// scheduling oscillator nodes, otherwise currentTime is frozen and nothing
// plays. navigator.vibrate does not exist on iOS at all, so audio is the
// only cue for the gait test (phone in pocket) and we also render a big
// visual flash for the tremor test (phone in hand).
async function buzz({ kind }) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'start' ? [180, 80, 180, 80, 180] : [280, 120, 280]);
    }
  } catch { /* ignore */ }
  try {
    const ctx = getAudioContext(); // throws if not unlocked yet
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch { /* may reject silently on iOS */ }
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square'; // square wave cuts through ambient noise better than sine
    if (kind === 'start') {
      // Three rising chirps, ~180ms each with 80ms gaps. Total ~0.80s.
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1100, now + 0.26);
      osc.frequency.setValueAtTime(1320, now + 0.52);
    } else {
      // Two descending chirps, ~220ms each. Total ~0.60s.
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(440, now + 0.26);
    }
    const endAt = kind === 'start' ? 0.80 : 0.60;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.45, now + 0.02);
    gain.gain.setValueAtTime(0.45, now + endAt - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + endAt);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + endAt + 0.02);
    console.log('[buzz]', kind, 'ctx.state=', ctx.state);
  } catch (err) {
    console.warn('[buzz] audio blocked:', err?.message);
  }
}

// Generate a PCM beep as a data URI so we can feed it to an HTML5 <audio>
// element as a backup path. Some environments block Web Audio but will play
// an Audio element, and vice versa. We try both on the test button.
function makeBeepDataURI({ freq = 1100, durationMs = 700, volume = 0.8 } = {}) {
  const sampleRate = 22050;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const bytes = 44 + samples * 2;
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x52494646, false);       // "RIFF"
  dv.setUint32(4, bytes - 8, true);
  dv.setUint32(8, 0x57415645, false);       // "WAVE"
  dv.setUint32(12, 0x666d7420, false);      // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);                // PCM
  dv.setUint16(22, 1, true);                // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461, false);      // "data"
  dv.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    // Square wave for max perceived loudness, with a short attack/decay envelope.
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.01, (durationMs / 1000 - t) / 0.04);
    const phase = ((freq * t) % 1) < 0.5 ? 1 : -1;
    const s = phase * volume * Math.max(0, env) * 32767;
    dv.setInt16(44 + i * 2, s | 0, true);
  }
  let bin = '';
  const view = new Uint8Array(buf);
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

let beepAudioEl = null;
function playBackupBeep() {
  try {
    if (!beepAudioEl) {
      beepAudioEl = new Audio(makeBeepDataURI());
      beepAudioEl.preload = 'auto';
      beepAudioEl.setAttribute('playsinline', 'true');
    }
    beepAudioEl.currentTime = 0;
    return beepAudioEl.play(); // Promise
  } catch (e) {
    return Promise.reject(e);
  }
}

// Fires both paths and returns a short diagnostic string for on-screen display.
// ctx state is read AFTER buzz so we know what iOS did with resume().
async function testSoundDiag() {
  let ctxBefore = 'none';
  let ctxAfter = 'none';
  let webAudioErr = null;
  let htmlAudioErr = null;
  try { unlockAudio(); } catch (e) { webAudioErr = e?.message || String(e); }
  try {
    const ctx = getAudioContext();
    ctxBefore = ctx.state;
    await buzz({ kind: 'start' });
    ctxAfter = ctx.state;
  } catch (e) {
    webAudioErr = webAudioErr || e?.message || String(e);
  }
  try {
    await playBackupBeep();
  } catch (e) {
    htmlAudioErr = e?.message || String(e);
  }
  const ua = navigator.userAgent.replace(/.*\((.*?)\).*/, '$1').slice(0, 48);
  return {
    ctxBefore, ctxAfter,
    webAudio: webAudioErr ? `FAIL ${webAudioErr}` : 'ok',
    htmlAudio: htmlAudioErr ? `FAIL ${htmlAudioErr}` : 'ok',
    vibrate: navigator.vibrate ? 'available' : 'none',
    ua,
  };
}

// Keep the iOS AudioContext alive during the 5s prep countdown by scheduling
// an inaudible tick every second. Without this, iOS Safari often suspends
// the context and the start buzz fails silently.
function startAudioKeepalive() {
  let cancelled = false;
  try {
    const ctx = getAudioContext();
    const tick = () => {
      if (cancelled) return;
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 20; // sub-audible
        gain.gain.setValueAtTime(0.0001, now);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  } catch {
    return () => {};
  }
}

const TREMOR_LABELS = {
  physiological: 'Expected adult pattern',
  essential_like: 'Higher-frequency signal',
  parkinsonian_like: 'Low-frequency signal · see GP',
};

export default function NeuroView({ onBack, demographics, onHeart }) {
  useCss();
  const [stage, setStage] = useState('intro');
  const [progress, setProgress] = useState(0);
  const [prepCount, setPrepCount] = useState(0);
  const [tremor, setTremor] = useState(null);
  const [gait, setGait] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [flash, setFlash] = useState(null); // 'go' | 'stop' | null
  const [soundDiag, setSoundDiag] = useState(null);

  async function fetchReport(currentTremor, currentGait) {
    setReportLoading(true);
    setReport(null);
    try {
      const res = await fetch('/api/analyze-neuro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tremor: currentTremor,
          gait: currentGait,
          demographics: demographics || {},
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReport(data.report);
    } catch (e) {
      console.warn('analyze-neuro failed', e);
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }

  async function ensurePermissionAndRun(fn) {
    setError(null);
    // Unlock the AudioContext within the user-gesture window. Without this,
    // the Neuro-only flow (never touched Breath) has no unlocked audio and
    // iOS Safari blocks beeps. Safe to call multiple times, it's idempotent.
    try { unlockAudio(); } catch { /* optional */ }
    try {
      const state = await requestMotionPermission();
      if (state !== 'granted') {
        setError('Motion access denied. On iOS, go to Settings > Safari > Motion & Orientation Access and enable it, then reload.');
        setStage('error');
        return;
      }
      await fn();
    } catch (e) {
      console.error(e);
      setError(e.message || String(e));
      setStage('error');
    }
  }

  function flashCue(kind, ms = 900) {
    setFlash(kind);
    setTimeout(() => setFlash(null), ms);
  }

  async function fireCue(kind) {
    // Fire both paths in parallel. If WebAudio is blocked, HTML5 Audio may
    // still play. If HTML5 Audio is blocked, WebAudio may still play.
    await Promise.allSettled([buzz({ kind }), playBackupBeep()]);
  }

  async function runTremor() {
    setStage('tremor_prep');
    setPrepCount(PREP_SECONDS);
    const stopKeepalive = startAudioKeepalive();
    await prep(PREP_SECONDS, setPrepCount);
    stopKeepalive();
    flashCue('go');
    await fireCue('start');
    setStage('tremor_record');
    setProgress(0);
    const motion = await captureMotion({ durationMs: 10000, onTick: ({ pct }) => setProgress(pct) });
    flashCue('stop');
    await fireCue('end');
    const result = analyseTremor(motion);
    setTremor(result);
    setStage('tremor_done');
  }

  async function runGait() {
    setStage('gait_prep');
    setPrepCount(PREP_SECONDS);
    const stopKeepalive = startAudioKeepalive();
    await prep(PREP_SECONDS, setPrepCount);
    stopKeepalive();
    flashCue('go');
    await fireCue('start');
    setStage('gait_record');
    setProgress(0);
    const motion = await captureMotion({ durationMs: 10000, onTick: ({ pct }) => setProgress(pct) });
    flashCue('stop');
    await fireCue('end');
    const result = analyseGait(motion);
    setGait(result);
    setStage('gait_done');
    fetchReport(tremor, result);
  }

  const remaining = Math.max(0, Math.ceil((1 - progress) * 10));

  const tremorState = stage === 'tremor_done' || stage === 'gait_prep' || stage === 'gait_record' || stage === 'gait_done'
    ? 'done'
    : (stage === 'tremor_prep' || stage === 'tremor_record') ? 'active' : 'idle';

  const gaitState = stage === 'gait_done' ? 'done'
    : (stage === 'gait_prep' || stage === 'gait_record') ? 'active' : 'idle';

  return (
    <div className="nv-stage">
      <div className="nv-head">
        <span className="eyebrow">Module 02 · Neuro</span>
        <h2 className="title">Two short tests.</h2>
        <p className="sub">Stillness plus gait, ten seconds each. Screening only, not diagnostic.</p>
      </div>

      {/* Test 1: Stillness */}
      <section className="nv-step" data-state={tremorState}>
        {flash && (tremorState === 'active') && (
          <div className="nv-flash" data-k={flash}>
            <span className="label">{flash === 'go' ? 'HOLD STILL' : 'DONE'}</span>
          </div>
        )}
        <div className="nv-step-hd">
          <span className="n">01</span>
          <span className="t">Stillness · Tremor</span>
        </div>
        <h3 className="nv-step-title">Hold the phone flat.</h3>
        <p className="nv-step-desc">
          Arm <strong>fully extended</strong>, palm flat. You will have 5 seconds to get in position,
          then hold still for 10. Do not grip hard.
        </p>

        {stage === 'intro' && (
          <>
            <div className="nv-volwarn">
              <span className="ic">§</span>
              <span>
                <strong>Volume up, silent switch off.</strong> The phone plays a start and stop cue.
                For the walk test, audio is how you know to start.
              </span>
            </div>
            <button
              className="nv-btn-ghost"
              onClick={async () => {
                const d = await testSoundDiag();
                setSoundDiag(d);
              }}
              style={{ marginBottom: 'var(--s-2)' }}
            >
              Tap to test sound
            </button>
            {soundDiag && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  lineHeight: 1.6,
                  padding: 'var(--s-3)',
                  background: 'rgba(244, 236, 225, 0.04)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 'var(--r-sm)',
                  color: 'var(--bone-1)',
                  wordBreak: 'break-word',
                  marginBottom: 'var(--s-2)',
                }}
              >
                ctx before: <strong>{soundDiag.ctxBefore}</strong><br/>
                ctx after: <strong>{soundDiag.ctxAfter}</strong><br/>
                web audio: <strong>{soundDiag.webAudio}</strong><br/>
                html audio: <strong>{soundDiag.htmlAudio}</strong><br/>
                vibrate: <strong>{soundDiag.vibrate}</strong><br/>
                ua: {soundDiag.ua}
              </div>
            )}
            <button className="nv-btn" onClick={() => ensurePermissionAndRun(runTremor)}>
              <span>Start stillness test</span>
              <span className="arrow">→</span>
            </button>
          </>
        )}

        {stage === 'tremor_prep' && (
          <div className="nv-prep">
            <div className="nv-prep-lab">Get ready</div>
            <div className="nv-prep-num">{prepCount}</div>
            <div className="nv-prep-hint">Extend your arm, let the phone rest flat.</div>
          </div>
        )}

        {stage === 'tremor_record' && (
          <div className="nv-record">
            <div className="nv-record-num">{remaining}</div>
            <div className="nv-record-progress">
              <div className="nv-record-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="nv-record-cue">Recording · hold still</div>
          </div>
        )}

        {tremor && (
          <>
            <div className="nv-result">
              <span className="k">Dominant frequency</span>
              <span className="v">{tremor.dominantFrequencyHz ? `${tremor.dominantFrequencyHz.toFixed(1)} Hz` : '-'}</span>
            </div>
            <div className="nv-result">
              <span className="k">Sample rate</span>
              <span className="v">{tremor.sampleRate} Hz</span>
            </div>
            <span className="nv-band" data-k={tremor.classification}>
              <span className="dot" />
              {TREMOR_LABELS[tremor.classification] || tremor.classification}
            </span>
            {(stage === 'tremor_done' || gaitState !== 'idle') && (
              <button
                className="nv-btn-ghost"
                onClick={() => ensurePermissionAndRun(runTremor)}
                disabled={stage === 'gait_prep' || stage === 'gait_record'}
              >
                Redo stillness test
              </button>
            )}
          </>
        )}
      </section>

      {/* Test 2: Gait */}
      {(stage === 'tremor_done' || stage === 'gait_prep' || stage === 'gait_record' || stage === 'gait_done') && (
        <section className="nv-step" data-state={gaitState}>
          {flash && (gaitState === 'active') && (
            <div className="nv-flash" data-k={flash}>
              <span className="label">{flash === 'go' ? 'WALK' : 'DONE'}</span>
            </div>
          )}
          <div className="nv-step-hd">
            <span className="n">02</span>
            <span className="t">Walk · Gait</span>
          </div>
          <h3 className="nv-step-title">Phone in your pocket.</h3>
          <p className="nv-step-desc">
            Put the phone in your trouser or jacket pocket. 5 seconds to pocket, then
            <strong> walk 10 natural steps</strong> in a straight line.
          </p>

          {stage === 'tremor_done' && (
            <button className="nv-btn" onClick={() => ensurePermissionAndRun(runGait)}>
              <span>Start walk test</span>
              <span className="arrow">→</span>
            </button>
          )}

          {stage === 'gait_prep' && (
            <div className="nv-prep">
              <div className="nv-prep-lab">Get ready</div>
              <div className="nv-prep-num">{prepCount}</div>
              <div className="nv-prep-hint">Pocket the phone and start walking.</div>
            </div>
          )}

          {stage === 'gait_record' && (
            <div className="nv-record">
              <div className="nv-record-num">{remaining}</div>
              <div className="nv-record-progress">
                <div className="nv-record-fill" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="nv-record-cue">Recording · keep walking</div>
            </div>
          )}

          {gait && (
            <>
              <div className="nv-result">
                <span className="k">Steps detected</span>
                <span className="v">{gait.stepsDetected}</span>
              </div>
              <div className="nv-result">
                <span className="k">Cadence</span>
                <span className="v">{gait.cadence > 0 ? `${Math.round(gait.cadence)} / min` : '-'}</span>
              </div>
              <div className="nv-result">
                <span className="k">Stride variability</span>
                <span className="v">{gait.stridesCv > 0 ? `${(gait.stridesCv * 100).toFixed(1)}%` : '-'}</span>
              </div>
              <div className="nv-result">
                <span className="k">Symmetry index</span>
                <span className="v">{gait.symmetryIndex != null ? gait.symmetryIndex.toFixed(2) : '-'}</span>
              </div>
              {stage === 'gait_done' && (
                <button className="nv-btn-ghost" onClick={() => ensurePermissionAndRun(runGait)}>
                  Redo walk test
                </button>
              )}
            </>
          )}
        </section>
      )}

      {/* Neuro report */}
      {stage === 'gait_done' && reportLoading && (
        <div className="nv-report">
          <div className="nv-analyzing">
            <div className="nv-analyzing-bars">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
            <div className="nv-analyzing-label">Reading your motion trace...</div>
            <div className="nv-analyzing-sub">GLM 5.1 is interpreting the signals</div>
          </div>
        </div>
      )}

      {stage === 'gait_done' && report && (
        <div className="nv-report">
          <div className="nv-report-hd">
            <span className="k">Neuro report</span>
            {report.source && (
              <span
                className="rv-source-chip"
                data-src={report.source}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.62rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 999,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  background: report.source === 'ai' ? 'rgba(231, 184, 126, 0.12)' : 'rgba(209, 133, 137, 0.08)',
                  color: report.source === 'ai' ? 'var(--brass-bright)' : 'var(--warn)',
                  border: report.source === 'ai' ? '1px solid var(--brass-line)' : '1px solid rgba(209, 133, 137, 0.2)',
                }}
              >
                {report.source === 'ai' ? '● GLM 5.1' : '○ template'}
              </span>
            )}
          </div>
          <p className="headline">{report.headline}</p>
          {report.interpretation && <p className="interp">{report.interpretation}</p>}
          {Array.isArray(report.actions) && report.actions.length > 0 && (
            <>
              <p className="nv-actions-label">What to do next</p>
              <ul className="nv-actions">
                {report.actions.map((a, i) => (
                  <li className="nv-action" key={i}>
                    <span className="num">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <span className="t">{a.title}</span>
                      <span className="d">{a.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.whenToWorry && (
            <div className="nv-worry">
              <span className="icon">§</span>
              <div>
                <span className="lab">When to see a GP</span>
                <span>{report.whenToWorry}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {stage === 'error' && <div className="nv-error">{error}</div>}

      <div className="nv-caveat">
        Screening only. Do not treat any result as a medical diagnosis. A physiological (&gt;11 Hz)
        band is the expected healthy adult pattern.
      </div>

      {onHeart && (stage === 'gait_done' || stage === 'tremor_done') && (
        <button className="nv-btn" onClick={onHeart}>
          <span>Try the Heart screen</span>
          <span className="arrow">→</span>
        </button>
      )}

      {onBack && (
        <button className="nv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
    </div>
  );
}
