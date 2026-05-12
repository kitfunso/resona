import React, { useEffect, useRef, useState } from 'react';
import { acquireCameraPermission, detectFirstFrameRoi, buildFallbackRois, captureRppg } from '../video/recorder.js';
import { extractHeartFeatures } from '../video/features.js';
import { classifyHeart } from '../video/regression.js';
import { analyzeHeart } from '../api.js';
import { CoachingCard } from './ResultsView.jsx';

const css = `
  .hv-stage {
    width: 100%;
    max-width: 30rem;
    display: flex; flex-direction: column;
    gap: var(--s-4);
    margin-top: var(--s-2);
    text-align: left;
  }
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

  .hv-step {
    padding: var(--s-5);
    border: 1px solid var(--hairline);
    background: rgba(26, 28, 38, 0.5);
    border-radius: var(--r-lg);
    display: flex; flex-direction: column; gap: var(--s-3);
    position: relative;
    overflow: hidden;
  }
  .hv-step[data-state="active"] {
    border-color: var(--warn);
    background: rgba(209, 133, 137, 0.06);
    box-shadow: 0 0 0 1px rgba(209, 133, 137, 0.35), 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  .hv-step[data-state="done"] {
    border-color: rgba(123, 193, 150, 0.28);
    background: rgba(123, 193, 150, 0.04);
  }
  .hv-step-title {
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-step-desc {
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--bone-2);
    margin: 0;
  }

  .hv-btn {
    appearance: none;
    width: 100%;
    padding: 1.1rem var(--s-4);
    border: 1px solid var(--brass);
    border-radius: var(--r-sm);
    background: linear-gradient(90deg, rgba(201, 169, 110, 0.08), rgba(231, 184, 126, 0.12));
    color: var(--brass-bright);
    font-family: var(--font-body);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex; align-items: center; justify-content: space-between;
  }
  .hv-btn-ghost {
    appearance: none;
    border: 1px solid var(--hairline-strong);
    background: transparent;
    color: var(--bone-2);
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    padding: 0.85rem var(--s-4);
    border-radius: var(--r-sm);
    cursor: pointer;
  }

  .hv-video-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #000;
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .hv-video {
    width: 100%; height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }
  .hv-oval {
    position: absolute; inset: 0;
    pointer-events: none;
    background:
      radial-gradient(ellipse 32% 42% at 50% 45%, transparent 0%, transparent 70%, rgba(0,0,0,0.62) 75%);
  }
  .hv-live-hr {
    position: absolute;
    bottom: 0.6rem; right: 0.6rem;
    background: rgba(18, 19, 26, 0.78);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.7rem;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--brass-bright);
  }
  .hv-progress {
    width: 100%;
    height: 6px;
    background: rgba(244, 236, 225, 0.06);
    border: 1px solid var(--hairline);
    border-radius: 2px;
    overflow: hidden;
  }
  .hv-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--brass), var(--warn));
    transition: width 0.06s linear;
  }
  .hv-count {
    font-family: var(--font-display);
    font-size: 3.4rem;
    line-height: 1;
    color: var(--bone-0);
    text-align: center;
  }

  .hv-result-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    padding: var(--s-3) 0;
    border-bottom: 1px dashed var(--hairline);
  }
  .hv-result-row:last-of-type { border-bottom: none; }
  .hv-result-row .k {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .hv-result-row .v {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 1.4rem;
    color: var(--bone-0);
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
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }
  .hv-chip[data-k="normal"] { background: var(--pulse-dim); color: var(--pulse-bright); border: 1px solid rgba(123, 193, 150, 0.3); }
  .hv-chip[data-k="tachycardia"] { background: var(--warn-dim); color: #f0c4c8; border: 1px solid rgba(209, 133, 137, 0.35); }
  .hv-chip[data-k="bradycardia"] { background: rgba(122, 169, 184, 0.12); color: #c0d8e2; border: 1px solid rgba(122, 169, 184, 0.3); }
  .hv-chip[data-k="fallback"] { background: rgba(231, 184, 126, 0.08); color: var(--brass-bright); border: 1px solid var(--brass-line); }

  .hv-report {
    background:
      radial-gradient(ellipse at top left, rgba(231, 184, 126, 0.08), transparent 60%),
      var(--ink-2);
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5);
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .hv-report .headline {
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1.2;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-report .interp {
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--bone-1);
    margin: 0;
  }
  .hv-actions {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .hv-action { display: grid; grid-template-columns: 2rem 1fr; gap: var(--s-3); }
  .hv-action .num { font-family: var(--font-display); font-size: 1.35rem; color: var(--brass); }
  .hv-action .t { font-weight: 700; color: var(--bone-0); display: block; }
  .hv-action .d { color: var(--bone-2); font-size: 0.85rem; display: block; }
  .hv-worry {
    margin-top: var(--s-2);
    padding: var(--s-3);
    background: rgba(231, 184, 126, 0.08);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-sm);
    color: var(--bone-1);
    font-size: 0.85rem;
  }
  .hv-error {
    padding: var(--s-3);
    background: var(--warn-dim);
    border: 1px solid rgba(209, 133, 137, 0.3);
    color: #f3c7c8;
    border-radius: var(--r-sm);
    font-size: var(--t-small);
  }
  .hv-analyzing { display: flex; flex-direction: column; align-items: center; gap: var(--s-4); padding: var(--s-6) 0; }
  .hv-analyzing-label { font-family: var(--font-display); font-size: var(--t-h3); color: var(--bone-1); }
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

export default function HeartView({ onBack, demographics }) {
  useCss();
  const [stage, setStage] = useState('intro'); // intro | prep | record | analyzing | result | coaching | error
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  return (
    <div className="hv-stage">
      <div className="hv-head">
        <span className="eyebrow">Module 03 · Heart</span>
        <h2 className="title">Resting pulse + variability.</h2>
        <p className="sub">30 seconds of front-camera video. We only keep the RGB averages, never the frames.</p>
      </div>

      {stage === 'intro' && (
        <section className="hv-step" data-state="idle">
          <h3 className="hv-step-title">Frame your face in the oval.</h3>
          <p className="hv-step-desc">
            Hold the phone steady, eyes on the camera, good even light. <strong>30 seconds.</strong>
          </p>
          <button className="hv-btn" onClick={() => { /* wired up next task */ }}>
            <span>Start heart screen</span>
            <span>→</span>
          </button>
        </section>
      )}

      {stage === 'error' && (
        <div className="hv-error">{error || 'Something went wrong with the heart screen.'}</div>
      )}

      {onBack && (
        <button className="hv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
    </div>
  );
}
