import React, { useState, useRef, useEffect } from 'react';
import { acquireCameraPermission, captureRPPG } from '../heart/camera.js';
import { analyseHeart } from '../heart/rppg.js';
import { analyzeHeart } from '../api.js';

// Resona Module 3 (Heart) capture view. Refinement R4: this ADAPTS NeuroView's
// primitives (useCss, the prep() countdown, the analyzing bars, the report
// card, the error block, ensurePermissionAndRun) into a SINGLE-CAPTURE
// FULL-STAGE flow. It deliberately does NOT clone NeuroView's stacked
// two-section layout. One capture, one stage machine:
//   intro -> prep -> capture -> analyzing -> report | retry | error
//
// CSS prefix is hv- so it never collides with nv- (Neuro) or rv- (Results).

const css = `
  .hv-stage {
    width: 100%;
    max-width: 30rem;
    display: flex; flex-direction: column;
    gap: var(--s-4);
    margin-top: var(--s-2);
    text-align: left;
  }

  /* ========= Head ========= */
  .hv-head {
    display: flex; flex-direction: column; gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .hv-head .eyebrow {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .hv-head .title {
    font-family: var(--font-display);
    font-size: 1.8rem;
    line-height: 1;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-head .sub {
    font-size: 0.82rem;
    color: var(--bone-2);
    line-height: 1.55;
    margin: 0;
  }

  /* ========= Capture card ========= */
  .hv-card {
    padding: var(--s-5);
    border: 1px solid var(--hairline);
    background: rgba(26, 28, 38, 0.5);
    border-radius: var(--r-lg);
    display: flex; flex-direction: column; gap: var(--s-4);
    position: relative;
    overflow: hidden;
  }
  .hv-card[data-state="active"] {
    border-color: var(--brass);
    background: rgba(231, 184, 126, 0.06);
    box-shadow: 0 0 0 1px var(--brass-line), 0 12px 40px rgba(0, 0, 0, 0.35);
  }

  .hv-card-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.5rem;
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-card-desc {
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--bone-2);
    margin: 0;
  }
  .hv-card-desc strong { color: var(--bone-0); font-weight: 600; }

  /* ========= Privacy line ========= */
  .hv-privacy {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s-3);
    align-items: center;
    padding: var(--s-3);
    background: rgba(123, 193, 150, 0.06);
    border: 1px solid rgba(123, 193, 150, 0.22);
    border-radius: var(--r-sm);
    font-size: 0.78rem;
    color: var(--bone-1);
    line-height: 1.45;
  }
  .hv-privacy .ic {
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--pulse-bright);
    line-height: 1;
  }
  .hv-privacy strong { color: var(--bone-0); font-weight: 700; }

  /* ========= Buttons ========= */
  .hv-btn {
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
  .hv-btn:hover { box-shadow: var(--shadow-brass); }
  .hv-btn:active { transform: scale(0.99); }
  .hv-btn:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
  .hv-btn .arrow {
    font-family: var(--font-display);
    font-size: 1.15rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--brass-dim);
  }
  .hv-btn-ghost {
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
  .hv-btn-ghost:hover { color: var(--bone-0); border-color: var(--bone-2); }

  /* ========= Camera instrument (R5: brass instrument treatment) =========
     The ROI oval guide reuses the r-instrument ring look: concentric brass
     hairline borders + brass-glow, so the camera frame reads as a Resona
     instrument, not a generic camera UI. */
  .hv-camera {
    position: relative;
    width: min(78vw, 320px);
    height: min(78vw, 320px);
    margin: var(--s-2) auto 0;
    border-radius: 50%;
    overflow: hidden;
    background: var(--ink-0);
    box-shadow:
      inset 0 0 0 1px var(--brass-line),
      0 18px 40px rgba(0, 0, 0, 0.55),
      0 0 48px var(--brass-glow);
  }
  /* R7: the <video> fills the round container with object-fit: cover. */
  .hv-camera video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    /* Front camera is mirrored so the preview matches a mirror, not a photo. */
    transform: scaleX(-1);
  }
  /* Concentric brass hairline rings, the r-instrument-ring treatment. */
  .hv-camera-ring {
    position: absolute; inset: 0;
    border-radius: 50%;
    border: 1px solid var(--brass-line);
    pointer-events: none;
    z-index: 3;
  }
  .hv-camera-ring::before,
  .hv-camera-ring::after {
    content: '';
    position: absolute; inset: 10px;
    border-radius: 50%;
    border: 1px dashed var(--brass-line);
    opacity: 0.55;
  }
  .hv-camera-ring::after {
    inset: 24px;
    border-style: solid;
    opacity: 0.32;
  }
  /* The ROI oval guide itself: a brass hairline ellipse over the face zone. */
  .hv-roi {
    position: absolute;
    left: 26%; top: 16%;
    width: 48%; height: 62%;
    border-radius: 50%;
    border: 1.5px solid var(--brass);
    box-shadow:
      0 0 0 1px rgba(10, 11, 16, 0.55),
      0 0 24px var(--brass-glow),
      inset 0 0 32px rgba(10, 11, 16, 0.4);
    pointer-events: none;
    z-index: 4;
  }
  .hv-roi[data-capture="true"] {
    border-color: var(--brass-bright);
    animation: hv-roi-pulse 1.6s ease-in-out infinite;
  }
  @keyframes hv-roi-pulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(10, 11, 16, 0.55), 0 0 18px var(--brass-glow), inset 0 0 32px rgba(10, 11, 16, 0.4); }
    50%      { box-shadow: 0 0 0 1px rgba(10, 11, 16, 0.55), 0 0 44px rgba(231, 184, 126, 0.4), inset 0 0 32px rgba(10, 11, 16, 0.4); }
  }
  /* Prep countdown number floats centred over the live preview. */
  .hv-camera-count {
    position: absolute;
    inset: 0;
    display: flex; align-items: center; justify-content: center;
    z-index: 5;
    pointer-events: none;
  }
  .hv-camera-count span {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 5rem;
    line-height: 0.9;
    color: var(--bone-0);
    text-shadow: 0 0 48px rgba(10, 11, 16, 0.9), 0 0 24px rgba(231, 184, 126, 0.45);
  }

  /* R5: lighting-hint text sits below the oval in the small-caps label style. */
  .hv-lighting {
    text-align: center;
    margin-top: var(--s-3);
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }
  .hv-lighting[data-ok="true"] { color: var(--pulse-bright); }
  .hv-lighting[data-ok="false"] { color: var(--brass-bright); }
  .hv-lighting .dot {
    display: inline-block;
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
    margin-right: 0.5em;
    vertical-align: middle;
  }

  /* ========= Capture progress ========= */
  .hv-progress-wrap {
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .hv-progress-num {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 4rem;
    line-height: 0.9;
    text-align: center;
    color: var(--bone-0);
  }
  .hv-progress {
    height: 4px;
    background: rgba(244, 236, 225, 0.06);
    border-radius: 2px;
    overflow: hidden;
    position: relative;
  }
  .hv-progress::before {
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
  .hv-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--brass), var(--brass-bright));
    box-shadow: 0 0 12px var(--brass-glow);
    transition: width 0.12s linear;
  }
  .hv-progress-cue {
    text-align: center;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--brass);
  }

  /* ========= Analyzing ========= */
  .hv-analyzing {
    display: flex; flex-direction: column; align-items: center;
    gap: var(--s-4);
    padding: var(--s-6) 0;
  }
  .hv-analyzing-bars {
    display: flex; gap: 5px;
    align-items: flex-end;
    height: 48px;
  }
  .hv-analyzing-bars span {
    display: block;
    width: 4px;
    background: var(--brass);
    border-radius: 1px;
    animation: hv-wave 1.1s ease-in-out infinite;
  }
  .hv-analyzing-bars span:nth-child(1) { animation-delay: 0s; }
  .hv-analyzing-bars span:nth-child(2) { animation-delay: 0.08s; }
  .hv-analyzing-bars span:nth-child(3) { animation-delay: 0.16s; }
  .hv-analyzing-bars span:nth-child(4) { animation-delay: 0.24s; }
  .hv-analyzing-bars span:nth-child(5) { animation-delay: 0.32s; }
  .hv-analyzing-bars span:nth-child(6) { animation-delay: 0.40s; }
  .hv-analyzing-bars span:nth-child(7) { animation-delay: 0.48s; }
  @keyframes hv-wave {
    0%, 100% { height: 8px; opacity: 0.55; }
    50%      { height: 48px; opacity: 1; }
  }
  .hv-analyzing-label {
    font-family: var(--font-display);
    font-size: 1.5rem;
    color: var(--bone-1);
  }
  .hv-analyzing-sub {
    font-size: 0.72rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--bone-3);
  }

  /* ========= bpm instrument card (R7: dedicated reading) ========= */
  .hv-bpm {
    background: linear-gradient(180deg, rgba(26, 28, 38, 0.75), rgba(18, 19, 26, 0.5));
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5) var(--s-5) var(--s-4);
    position: relative;
    overflow: hidden;
  }
  .hv-bpm::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--brass) 50%, transparent);
    opacity: 0.5;
  }
  .hv-bpm-hd {
    display: flex; justify-content: space-between; align-items: baseline;
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
    margin-bottom: var(--s-4);
  }
  .hv-bpm-hd .title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.6rem;
    line-height: 1;
    color: var(--bone-0);
  }
  .hv-bpm-hd .id {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    color: var(--bone-3);
  }
  .hv-bpm-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: var(--s-3);
    padding: var(--s-2) 0;
  }
  .hv-bpm-row .key {
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .hv-bpm-row .val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 2.6rem;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--bone-0);
    line-height: 1;
  }
  .hv-bpm-row .val .unit {
    font-size: 0.85rem;
    color: var(--bone-3);
    margin-left: 0.4rem;
    letter-spacing: 0.08em;
  }
  .hv-bpm-sub {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: var(--s-3);
    margin-top: var(--s-3);
    padding-top: var(--s-3);
    border-top: 1px dashed var(--hairline);
  }
  .hv-bpm-sub .key {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .hv-bpm-sub .v {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.95rem;
    color: var(--bone-1);
  }

  /* Quality + classification chips. */
  .hv-chips {
    display: flex; flex-wrap: wrap; gap: var(--s-2);
    margin-top: var(--s-4);
  }
  .hv-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-sm);
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  .hv-chip[data-k="good"],
  .hv-chip[data-k="normal"] {
    background: var(--pulse-dim);
    color: var(--pulse-bright);
    border: 1px solid rgba(123, 193, 150, 0.3);
  }
  .hv-chip[data-k="weak"],
  .hv-chip[data-k="elevated"] {
    background: rgba(231, 184, 126, 0.1);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }
  .hv-chip[data-k="low"] {
    background: var(--cool-dim);
    color: #a9d0db;
    border: 1px solid rgba(122, 169, 184, 0.32);
  }
  .hv-chip .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor; box-shadow: 0 0 8px currentColor;
  }

  /* ========= Heart report card ========= */
  .hv-report {
    background:
      radial-gradient(ellipse at top right, rgba(209, 133, 137, 0.06), transparent 60%),
      var(--ink-2);
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5);
    display: flex; flex-direction: column; gap: var(--s-4);
  }
  .hv-report-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .hv-report-hd .k {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .hv-source-chip {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-pill);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .hv-source-chip[data-src="ai"] {
    background: rgba(231, 184, 126, 0.12);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }
  .hv-source-chip[data-src="fallback"] {
    background: rgba(209, 133, 137, 0.08);
    color: var(--warn);
    border: 1px solid rgba(209, 133, 137, 0.2);
  }
  .hv-report .headline {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.5rem;
    line-height: 1.2;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-report .interp {
    font-family: var(--font-body);
    font-size: 0.92rem;
    line-height: 1.6;
    color: var(--bone-1);
    margin: 0;
  }
  .hv-actions-label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--bone-3);
    display: flex; align-items: center; gap: var(--s-2);
    margin: 0;
  }
  .hv-actions-label::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }
  .hv-actions {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .hv-action {
    display: grid;
    grid-template-columns: 2rem 1fr;
    gap: var(--s-3);
    align-items: start;
    line-height: 1.5;
  }
  .hv-action .num {
    font-family: var(--font-display);
    font-size: 1.35rem;
    color: var(--brass);
    line-height: 1;
    margin-top: 0.1rem;
  }
  .hv-action .t {
    display: block; font-weight: 700; font-size: 0.95rem; color: var(--bone-0);
    margin-bottom: 0.2rem;
  }
  .hv-action .d {
    display: block; font-size: 0.85rem; color: var(--bone-2); line-height: 1.5;
  }
  .hv-worry {
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
  .hv-worry .icon {
    font-family: var(--font-display); font-size: 1.3rem;
    color: var(--brass-bright); line-height: 1;
  }
  .hv-worry .lab {
    display: block; font-size: 0.62rem; font-weight: 700;
    letter-spacing: 0.24em; text-transform: uppercase;
    color: var(--brass-bright); margin-bottom: 0.2rem;
  }

  /* ========= Retry coaching card (Breath CoachingCard tone) ========= */
  .hv-coaching {
    padding: var(--s-5);
    background: rgba(231, 184, 126, 0.08);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-lg);
    color: var(--bone-0);
    text-align: center;
    display: flex; flex-direction: column; gap: var(--s-2);
  }
  .hv-coaching .lab {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .hv-coaching .msg {
    font-family: var(--font-display);
    font-size: 1.3rem;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }

  /* ========= Caveat + error ========= */
  .hv-caveat {
    padding: var(--s-3) var(--s-4);
    background: rgba(244, 236, 225, 0.03);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    font-size: 0.78rem;
    color: var(--bone-2);
    line-height: 1.5;
  }
  .hv-error {
    padding: var(--s-3) var(--s-4);
    background: var(--warn-dim);
    border: 1px solid rgba(209, 133, 137, 0.3);
    color: #f3c7c8;
    border-radius: var(--r-sm);
    font-size: 0.85rem;
    line-height: 1.5;
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
const CAPTURE_MS = 20000;

// Countdown helper, the prep() pattern lifted from NeuroView. Resolves after
// `seconds` whole-second ticks, calling onTick down to 0.
async function prep(seconds, onTick) {
  for (let s = seconds; s > 0; s--) {
    onTick(s);
    await new Promise((r) => setTimeout(r, 1000));
  }
  onTick(0);
}

// Brightness 0..1 from onFrameStats -> lighting hint. The rPPG signal needs
// enough light to read skin colour change; too dark and the green channel
// floors out. Threshold is deliberately forgiving so an indoor office passes.
const LIGHTING_MIN = 0.22;
function lightingOk(brightness) {
  return brightness != null && brightness >= LIGHTING_MIN;
}

function captureCaseId() {
  const d = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const ddmm = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `RSN·${ddmm}·${hhmm}`;
}

const QUALITY_LABEL = {
  good: 'Clean signal',
  weak: 'Faint signal',
  invalid: 'Could not read',
};

const CLASSIFICATION_LABEL = {
  low: 'Below resting range',
  normal: 'Resting range',
  elevated: 'Above resting range',
};

export default function HeartView({ onBack, demographics }) {
  useCss();
  const [stage, setStage] = useState('intro');
  const [prepCount, setPrepCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [brightness, setBrightness] = useState(null);
  const [heart, setHeart] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [caseIdVal] = useState(captureCaseId);

  // The live <video> element is owned by camera.js (created/torn down per
  // capture). We mirror its preview into this on-screen container during the
  // prep + capture stages by appending camera.js's element here is not
  // possible (camera.js keeps its element private), so we run our own preview
  // stream for prep and let captureRPPG own the capture stream. Simpler: we
  // hold one preview stream for prep, stop it, then captureRPPG opens its own.
  const previewRef = useRef(null);
  const previewStreamRef = useRef(null);

  // Tear the preview stream down if the component unmounts mid-flow.
  useEffect(() => {
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPreview() {
    const stream = previewStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  }

  // Start a front-camera preview stream for the prep stage so the user can
  // line their face up in the oval before the 20 s capture begins.
  async function startPreview() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      throw new Error('Camera API not available on this device');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
    previewStreamRef.current = stream;
    if (previewRef.current) {
      previewRef.current.srcObject = stream;
      try {
        await previewRef.current.play();
      } catch {
        /* autoplay attributes cover this; ignore a rejected play() */
      }
    }
  }

  // R6: wrap the camera-permission acquisition. Catches getUserMedia
  // NotAllowedError specifically and sets an OS-specific recovery string,
  // mirroring NeuroView's denied-motion guidance.
  async function ensurePermissionAndRun(fn) {
    setError(null);
    try {
      await acquireCameraPermission();
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        setError(
          'Camera access is blocked. On iPhone: Settings > Safari > Camera, then reload this page. On Android Chrome: tap the lock icon in the address bar, allow Camera, then reload.',
        );
      } else if (e && e.name === 'NotFoundError') {
        setError('No camera was found on this device. Heart screening needs a front camera.');
      } else {
        setError(e?.message || String(e));
      }
      setStage('error');
      return;
    }
    try {
      await fn();
    } catch (e) {
      console.error('heart capture failed', e);
      setError(e?.message || String(e));
      setStage('error');
    }
  }

  async function fetchReport(currentHeart) {
    try {
      const data = await analyzeHeart({
        heart: currentHeart,
        demographics: demographics || {},
      });
      setReport(data && data.report ? data.report : null);
    } catch (e) {
      console.warn('analyze-heart failed', e);
      setReport(null);
    }
  }

  // The full single-capture run: prep countdown -> 20 s capture -> analyze.
  async function runCapture() {
    setHeart(null);
    setReport(null);
    setBrightness(null);

    // Prep stage: live preview + 5 s countdown.
    setStage('prep');
    setPrepCount(PREP_SECONDS);
    await startPreview();
    await prep(PREP_SECONDS, setPrepCount);
    // Release the preview stream so captureRPPG can open its own cleanly.
    stopPreview();

    // Capture stage: ~20 s rPPG capture, progress + live lighting hint.
    setStage('capture');
    setProgress(0);
    const result = await captureRPPG({
      durationMs: CAPTURE_MS,
      onTick: ({ pct }) => setProgress(pct),
      onFrameStats: ({ brightness: b }) => setBrightness(b),
    });

    // Analyzing stage: local DSP, then the LLM narrative.
    setStage('analyzing');
    const features = analyseHeart(result);
    setHeart(features);

    if (features.quality === 'invalid') {
      // Too noisy to interpret: route to the retry coaching card, skip the
      // LLM call (there is no honest narrative for an invalid reading).
      setStage('retry');
      return;
    }

    await fetchReport(features);
    setStage('report');
  }

  const captureSecondsLeft = Math.max(0, Math.ceil((1 - progress) * (CAPTURE_MS / 1000)));
  const isLightingOk = lightingOk(brightness);

  return (
    <div className="hv-stage">
      <div className="hv-head">
        <span className="eyebrow">Module 03 &middot; Heart</span>
        <h2 className="title">One steady look.</h2>
        <p className="sub">
          The front camera reads your pulse from tiny colour changes in your skin.
          Twenty seconds, holding still. Screening only, not diagnostic.
        </p>
      </div>

      {/* ===== intro ===== */}
      {stage === 'intro' && (
        <section className="hv-card">
          <h3 className="hv-card-title">Hold your face in the oval.</h3>
          <p className="hv-card-desc">
            Sit somewhere with <strong>even, steady light</strong> on your face. Hold the
            phone at arm's length, line your face up inside the brass oval, and stay still.
            You will get 5 seconds to settle, then a 20 second reading.
          </p>
          <div className="hv-privacy">
            <span className="ic">&sect;</span>
            <span>
              <strong>Your video stays on your phone.</strong> Only the heart-rate number is sent.
            </span>
          </div>
          <button className="hv-btn" onClick={() => ensurePermissionAndRun(runCapture)}>
            <span>Start heart screen</span>
            <span className="arrow">&rarr;</span>
          </button>
        </section>
      )}

      {/* ===== prep ===== */}
      {stage === 'prep' && (
        <section className="hv-card" data-state="active">
          <h3 className="hv-card-title">Line up your face.</h3>
          <p className="hv-card-desc">
            Fit your face inside the oval and hold still. The reading starts when the
            countdown reaches zero.
          </p>
          <div className="hv-camera">
            <video ref={previewRef} playsInline muted autoPlay />
            <div className="hv-camera-ring" />
            <div className="hv-roi" />
            <div className="hv-camera-count">
              <span>{prepCount}</span>
            </div>
          </div>
          <div className="hv-lighting" data-ok={isLightingOk}>
            <span className="dot" />
            {brightness == null
              ? 'Checking light'
              : isLightingOk
              ? 'Lighting looks good'
              : 'Find brighter light'}
          </div>
        </section>
      )}

      {/* ===== capture ===== */}
      {stage === 'capture' && (
        <section className="hv-card" data-state="active">
          <h3 className="hv-card-title">Hold still, face in the oval.</h3>
          <p className="hv-card-desc">
            Keep your face steady inside the oval. Breathe normally. Try not to talk or move.
          </p>
          <div className="hv-camera">
            {/* captureRPPG owns its own offscreen video during capture, so the
                preview here is the framed oval guide over a dark instrument
                face. The brass oval pulses to signal a live reading. */}
            <div className="hv-camera-ring" />
            <div className="hv-roi" data-capture="true" />
          </div>
          <div className="hv-lighting" data-ok={isLightingOk}>
            <span className="dot" />
            {brightness == null
              ? 'Reading'
              : isLightingOk
              ? 'Lighting looks good'
              : 'Find brighter light'}
          </div>
          <div className="hv-progress-wrap">
            <div className="hv-progress-num">{captureSecondsLeft}</div>
            <div className="hv-progress">
              <div className="hv-progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="hv-progress-cue">Reading &middot; hold still</div>
          </div>
        </section>
      )}

      {/* ===== analyzing ===== */}
      {stage === 'analyzing' && (
        <section className="hv-card">
          <div className="hv-analyzing">
            <div className="hv-analyzing-bars">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
            <div className="hv-analyzing-label">Reading your pulse...</div>
            <div className="hv-analyzing-sub">GPT-5.4 is interpreting the signal</div>
          </div>
        </section>
      )}

      {/* ===== report ===== */}
      {stage === 'report' && heart && (
        <>
          {/* R7: bpm gets a dedicated instrument card, not buried inline. */}
          <div className="hv-bpm">
            <div className="hv-bpm-hd">
              <span className="title">Your pulse</span>
              <span className="id">{caseIdVal}</span>
            </div>
            <div className="hv-bpm-row">
              <span className="key">Heart rate</span>
              <span className="val">
                {heart.bpm}
                <span className="unit">bpm</span>
              </span>
            </div>
            <div className="hv-bpm-sub">
              <span className="key">Signal to noise</span>
              <span className="v">{heart.snrDb} dB</span>
            </div>
            {heart.hrvProxyMs != null && (
              <div className="hv-bpm-sub">
                <span className="key">Beat variability</span>
                <span className="v">{heart.hrvProxyMs} ms</span>
              </div>
            )}
            <div className="hv-chips">
              <span className="hv-chip" data-k={heart.quality}>
                <span className="dot" />
                {QUALITY_LABEL[heart.quality] || heart.quality}
              </span>
              {heart.classification && (
                <span className="hv-chip" data-k={heart.classification}>
                  <span className="dot" />
                  {CLASSIFICATION_LABEL[heart.classification] || heart.classification}
                </span>
              )}
            </div>
          </div>

          {/* The LLM narrative, mirroring the Neuro report card. */}
          {report ? (
            <div className="hv-report">
              <div className="hv-report-hd">
                <span className="k">Heart report</span>
                {report.source && (
                  <span className="hv-source-chip" data-src={report.source}>
                    {report.source === 'ai' ? '● GPT-5.4' : '○ template'}
                  </span>
                )}
              </div>
              <p className="headline">{report.headline}</p>
              {report.interpretation && <p className="interp">{report.interpretation}</p>}
              {Array.isArray(report.actions) && report.actions.length > 0 && (
                <>
                  <p className="hv-actions-label">What to do next</p>
                  <ul className="hv-actions">
                    {report.actions.map((a, i) => (
                      <li className="hv-action" key={i}>
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
                <div className="hv-worry">
                  <span className="icon">&sect;</span>
                  <div>
                    <span className="lab">When to see a GP</span>
                    <span>{report.whenToWorry}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="hv-caveat">
              We could not reach the report service, so there is no written summary this time.
              Your heart rate above still stands as a screening reading.
            </div>
          )}

          <div className="hv-caveat">
            Screening only. A camera pulse reading is not a clinical measurement. See a GP for
            anything that concerns you.
          </div>

          {onBack && (
            <button className="hv-btn-ghost" onClick={onBack}>Back to results</button>
          )}
        </>
      )}

      {/* ===== retry (invalid reading) ===== */}
      {stage === 'retry' && (
        <>
          <div className="hv-coaching">
            <div className="lab">Try again</div>
            <p className="msg">Too much movement or low light. Let us try that again.</p>
          </div>
          <p className="hv-card-desc" style={{ textAlign: 'center' }}>
            Find a brighter, evenly lit spot, rest your elbows so the phone stays still, and
            keep your face fully inside the oval for the full 20 seconds.
          </p>
          <button className="hv-btn" onClick={() => ensurePermissionAndRun(runCapture)}>
            <span>Re-take the reading</span>
            <span className="arrow">&rarr;</span>
          </button>
          {onBack && (
            <button className="hv-btn-ghost" onClick={onBack}>Back to results</button>
          )}
        </>
      )}

      {/* ===== error ===== */}
      {stage === 'error' && (
        <>
          <div className="hv-error">{error}</div>
          <button className="hv-btn-ghost" onClick={() => setStage('intro')}>
            Try again
          </button>
          {onBack && (
            <button className="hv-btn-ghost" onClick={onBack}>Back to results</button>
          )}
        </>
      )}
    </div>
  );
}
