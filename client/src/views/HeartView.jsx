import React, { useEffect, useRef, useState } from 'react';
import { acquireCameraPermission, captureRppg } from '../video/recorder.js';
import { extractHeartFeatures } from '../video/features.js';
import { estimateHeart } from '../video/regression.js';
import { analyzeHeart } from '../api.js';

const CAPTURE_MS = 30000;
const PREP_SECONDS = 5;

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
    border-color: var(--brass);
    background: rgba(231, 184, 126, 0.06);
    box-shadow: 0 0 0 1px var(--brass-line), 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  .hv-step[data-state="done"] {
    border-color: rgba(123, 193, 150, 0.28);
    background: rgba(123, 193, 150, 0.04);
  }
  .hv-step-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2);
  }
  .hv-step-hd .n {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 2.4rem;
    line-height: 0.9;
    color: var(--brass);
  }
  .hv-step-hd .t {
    flex: 1;
    text-align: right;
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .hv-step[data-state="active"] .hv-step-hd .t { color: var(--brass); }
  .hv-step[data-state="done"] .hv-step-hd .t { color: var(--pulse); }
  .hv-step-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.5rem;
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }
  .hv-step-desc {
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--bone-2);
    margin: 0;
  }
  .hv-step-desc strong { color: var(--bone-0); font-weight: 600; }

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

  /* ======= Live preview ======= */
  .hv-cam-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--ink-0);
    border: 1px solid var(--hairline);
    box-shadow: inset 0 0 0 1px var(--brass-line);
  }
  .hv-cam-wrap video {
    width: 100%; height: 100%;
    object-fit: cover;
    transform: scaleX(-1); /* mirror so the user sees themselves naturally */
    background: var(--ink-0);
  }
  /* Face-oval guide overlay: keep face centred for the ROI sampler. */
  .hv-cam-overlay {
    position: absolute; inset: 0;
    pointer-events: none;
    display: flex; align-items: center; justify-content: center;
  }
  .hv-cam-overlay::before {
    content: '';
    width: 62%;
    height: 78%;
    border: 2px dashed var(--brass);
    border-radius: 50%;
    box-shadow:
      0 0 0 9999px rgba(10, 11, 16, 0.55),
      0 0 40px rgba(231, 184, 126, 0.4) inset;
    opacity: 0.85;
  }
  .hv-cam-hint {
    position: absolute;
    left: 0; right: 0;
    bottom: var(--s-3);
    text-align: center;
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--brass);
  }

  /* Live HR readout (during capture) */
  .hv-live {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    background: rgba(231, 184, 126, 0.08);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-sm);
  }
  .hv-live .lab {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .hv-live .v {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 1.6rem;
    color: var(--bone-0);
    letter-spacing: -0.01em;
  }
  .hv-live .v .unit {
    font-size: 0.65rem;
    color: var(--bone-3);
    margin-left: 0.3rem;
    letter-spacing: 0.18em;
  }

  /* Prep + record (re-uses NeuroView visual language but scoped here) */
  .hv-prep {
    display: flex; flex-direction: column; align-items: center; gap: var(--s-2);
    padding: var(--s-4) 0;
  }
  .hv-prep-lab {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .hv-prep-num {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 5rem;
    line-height: 0.9;
    color: var(--bone-0);
    text-shadow: 0 0 48px rgba(231, 184, 126, 0.35);
  }
  .hv-prep-hint {
    font-size: 0.92rem;
    color: var(--bone-1);
    text-align: center;
    max-width: 20rem;
    line-height: 1.45;
  }

  .hv-record {
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .hv-record-num {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 3.4rem;
    line-height: 0.9;
    text-align: center;
    color: var(--bone-0);
  }
  .hv-record-progress {
    height: 4px;
    background: rgba(244, 236, 225, 0.06);
    border-radius: 2px;
    overflow: hidden;
    position: relative;
  }
  .hv-record-progress::before {
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
  .hv-record-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--warn), var(--brass-bright));
    box-shadow: 0 0 12px var(--brass-glow);
    transition: width 0.1s linear;
  }
  .hv-record-cue {
    text-align: center;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--brass);
  }

  /* ======= Result rows ======= */
  .hv-readings {
    background: linear-gradient(180deg, rgba(26, 28, 38, 0.75), rgba(18, 19, 26, 0.5));
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5);
    position: relative;
    overflow: hidden;
  }
  .hv-readings::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--warn) 50%, transparent);
    opacity: 0.6;
  }
  .hv-result {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--s-3);
    align-items: baseline;
    padding: var(--s-3) 0;
    border-bottom: 1px dashed var(--hairline);
  }
  .hv-result:last-of-type { border-bottom: none; }
  .hv-result .k {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .hv-result .v {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--bone-0);
    letter-spacing: -0.01em;
  }
  .hv-result .v .unit {
    font-size: 0.7rem;
    color: var(--bone-3);
    margin-left: 0.3rem;
    letter-spacing: 0.18em;
  }

  .hv-band {
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
  .hv-band[data-k="normal"] {
    background: var(--pulse-dim);
    color: var(--pulse-bright);
    border: 1px solid rgba(123, 193, 150, 0.3);
  }
  .hv-band[data-k="tachycardia"] {
    background: var(--warn-dim);
    color: #f0c4c8;
    border: 1px solid rgba(209, 133, 137, 0.35);
  }
  .hv-band[data-k="bradycardia"] {
    background: rgba(122, 169, 184, 0.12);
    color: #b9d6e2;
    border: 1px solid rgba(122, 169, 184, 0.35);
  }
  .hv-band[data-k="unknown"] {
    background: rgba(244, 236, 225, 0.06);
    color: var(--bone-2);
    border: 1px solid var(--hairline);
  }
  .hv-band .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor; box-shadow: 0 0 8px currentColor;
  }

  .hv-quality {
    margin-top: var(--s-3);
    display: flex; gap: var(--s-2); flex-wrap: wrap;
  }
  .hv-quality-chip {
    padding: 0.25rem var(--s-2);
    border-radius: var(--r-pill);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .hv-quality-chip[data-grade="good"] {
    background: var(--pulse-dim);
    color: var(--pulse-bright);
    border: 1px solid rgba(123, 193, 150, 0.3);
  }
  .hv-quality-chip[data-grade="fair"] {
    background: rgba(231, 184, 126, 0.1);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }
  .hv-quality-chip[data-grade="poor"] {
    background: var(--warn-dim);
    color: #f0c4c8;
    border: 1px solid rgba(209, 133, 137, 0.35);
  }

  /* ======= Report card (same shape as Neuro/Breath) ======= */
  .hv-report {
    background:
      radial-gradient(ellipse at top left, rgba(209, 133, 137, 0.08), transparent 60%),
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

const HR_LABEL = {
  normal:      'Within typical range',
  tachycardia: 'Higher than typical',
  bradycardia: 'Lower than typical',
  unknown:     'Signal too noisy',
};

const QUALITY_LABEL = {
  good: 'Signal · good',
  fair: 'Signal · fair',
  poor: 'Signal · poor',
};

async function prepCountdown(seconds, onTick) {
  for (let s = seconds; s > 0; s--) {
    onTick(s);
    await new Promise((r) => setTimeout(r, 1000));
  }
  onTick(0);
}

// Live mid-capture HR estimate. Rough — we trim the leading 6s (transient
// as the autoexposure settles) and detrend with a simple long mean. Good
// enough to show the user a moving number; final HR is computed by the
// proper feature pipeline at the end.
function liveHrFromSamples(samples) {
  if (samples.length < 150) return null;
  // Use the last 8 seconds.
  const tail = samples.slice(Math.max(0, samples.length - Math.min(samples.length, 240)));
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  // Count zero-crossings of detrended signal as a proxy for beats.
  let crossings = 0;
  let prev = tail[0] - mean;
  for (let i = 1; i < tail.length; i++) {
    const v = tail[i] - mean;
    if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) crossings++;
    prev = v;
  }
  const beats = crossings / 2;
  // Frames here are at native FPS (we don't know exact fps mid-stream); use
  // assumed 30 fps which matches the recorder ROI target.
  const seconds = tail.length / 30;
  if (seconds <= 0) return null;
  const hr = (beats / seconds) * 60;
  if (hr < 35 || hr > 220) return null;
  return Math.round(hr);
}

export default function HeartView({ demographics, onBack }) {
  useCss();
  const videoRef = useRef(null);
  const liveSamplesRef = useRef([]);
  const [stage, setStage] = useState('intro'); // intro | prep | record | analyzing | result | error
  const [prepCount, setPrepCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [liveHr, setLiveHr] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState(null);

  // Attach the live preview <video> once when the user moves into prep so it
  // has time to display before recording starts (camera takes ~1s to settle
  // exposure on most phones).
  useEffect(() => {
    if (stage !== 'prep' && stage !== 'record') {
      // Stop any preview stream when not needed.
      if (videoRef.current && videoRef.current.srcObject) {
        try {
          videoRef.current.srcObject.getTracks?.().forEach((t) => t.stop());
        } catch { /* ignore */ }
        videoRef.current.srcObject = null;
      }
    }
  }, [stage]);

  async function startCapture() {
    setError(null);
    setEstimate(null);
    setReport(null);
    setLiveHr(null);
    liveSamplesRef.current = [];
    try {
      // Trigger the permission prompt OUTSIDE the prep window so the OS
      // dialog doesn't pop on top of the countdown.
      await acquireCameraPermission();
    } catch (err) {
      setError('Camera permission is required for the heart screen. Please allow camera access and try again.');
      setStage('error');
      return;
    }
    setStage('prep');
    setPrepCount(PREP_SECONDS);
    await prepCountdown(PREP_SECONDS, setPrepCount);
    setStage('record');
    setProgress(0);
    try {
      const capture = await captureRppg({
        durationMs: CAPTURE_MS,
        videoElement: videoRef.current,
        onTick: ({ pct }) => setProgress(pct),
        onSample: (gMean) => {
          liveSamplesRef.current.push(gMean);
          // Update live HR every ~30 samples (~1s).
          if (liveSamplesRef.current.length % 30 === 0) {
            const hr = liveHrFromSamples(liveSamplesRef.current);
            if (hr != null) setLiveHr(hr);
          }
        },
      });
      setStage('analyzing');
      const features = extractHeartFeatures(capture);
      const est = estimateHeart({ features, demographics });
      setEstimate(est);
      setReportLoading(true);
      try {
        const apiResult = await analyzeHeart({
          heart: {
            hrBpm: est.hrBpm,
            hrvRmssdMs: est.hrvRmssdMs,
            sdnnMs: est.sdnnMs,
            snr: est.snr,
            beatCount: est.beatCount,
            durationSec: est.durationSec,
            hrClassification: est.hrClassification,
            hrvClassification: est.hrvClassification,
            quality: est.quality,
            ageNote: est.ageNote,
          },
          demographics: demographics || {},
        });
        setReport(apiResult.report);
      } catch (err) {
        console.warn('analyze-heart failed', err);
        setReport(null);
      } finally {
        setReportLoading(false);
      }
      setStage('result');
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStage('error');
    }
  }

  const remaining = Math.max(0, Math.ceil((1 - progress) * (CAPTURE_MS / 1000)));
  const stepState = stage === 'result' ? 'done'
    : (stage === 'prep' || stage === 'record' || stage === 'analyzing') ? 'active'
    : 'idle';

  const fmtMs = (x) => (x != null ? `${Math.round(x)}` : '-');
  const fmtBpm = (x) => (x != null ? `${Math.round(x)}` : '-');

  return (
    <div className="hv-stage">
      <div className="hv-head">
        <span className="eyebrow">Module 03 · Heart</span>
        <h2 className="title">A 30-second pulse read.</h2>
        <p className="sub">
          Your phone's front camera reads tiny colour shifts in your face that track your heartbeat.
          Sit still, even light, no talking. Screening only.
        </p>
      </div>

      <section className="hv-step" data-state={stepState}>
        <div className="hv-step-hd">
          <span className="n">01</span>
          <span className="t">Pulse · rPPG</span>
        </div>
        <h3 className="hv-step-title">Frame your face in the oval.</h3>
        <p className="hv-step-desc">
          Hold the phone at <strong>arm's length</strong>, face evenly lit. You will have 5 seconds
          to settle, then stay still for <strong>30 seconds</strong>. Breathe naturally.
        </p>

        {(stage === 'prep' || stage === 'record') && (
          <div className="hv-cam-wrap">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="hv-cam-overlay" />
            <div className="hv-cam-hint">
              {stage === 'prep' ? 'Centre your face' : 'Hold still'}
            </div>
          </div>
        )}

        {stage === 'intro' && (
          <button className="hv-btn" onClick={startCapture}>
            <span>Start heart screen</span>
            <span className="arrow">→</span>
          </button>
        )}

        {stage === 'prep' && (
          <div className="hv-prep">
            <div className="hv-prep-lab">Get ready</div>
            <div className="hv-prep-num">{prepCount}</div>
            <div className="hv-prep-hint">Centre your face in the oval and stay still.</div>
          </div>
        )}

        {stage === 'record' && (
          <>
            <div className="hv-record">
              <div className="hv-record-num">{remaining}</div>
              <div className="hv-record-progress">
                <div className="hv-record-fill" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="hv-record-cue">Recording · keep still</div>
            </div>
            <div className="hv-live">
              <span className="lab">Live heart rate</span>
              <span className="v">
                {liveHr != null ? fmtBpm(liveHr) : '— —'}<span className="unit">bpm</span>
              </span>
            </div>
          </>
        )}
      </section>

      {stage === 'analyzing' && (
        <div className="hv-report">
          <div className="hv-analyzing">
            <div className="hv-analyzing-bars">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
            <div className="hv-analyzing-label">Reading the pulse...</div>
            <div className="hv-analyzing-sub">Detrending, FFT, peak picking</div>
          </div>
        </div>
      )}

      {stage === 'result' && estimate && (
        <>
          <div className="hv-readings">
            <div className="hv-result">
              <span className="k">Resting HR</span>
              <span className="v">{fmtBpm(estimate.hrBpm)}<span className="unit">bpm</span></span>
            </div>
            <div className="hv-result">
              <span className="k">HRV (RMSSD)</span>
              <span className="v">{fmtMs(estimate.hrvRmssdMs)}<span className="unit">ms</span></span>
            </div>
            <div className="hv-result">
              <span className="k">SDNN</span>
              <span className="v">{fmtMs(estimate.sdnnMs)}<span className="unit">ms</span></span>
            </div>
            <div className="hv-result">
              <span className="k">Beats detected</span>
              <span className="v">{estimate.beatCount ?? '-'}</span>
            </div>

            <span className="hv-band" data-k={estimate.hrClassification || 'unknown'}>
              <span className="dot" />
              {HR_LABEL[estimate.hrClassification] || HR_LABEL.unknown}
            </span>

            <div className="hv-quality">
              <span className="hv-quality-chip" data-grade={estimate.quality.grade}>
                {QUALITY_LABEL[estimate.quality.grade]}
              </span>
              {estimate.hrBpmOutOfRange && (
                <span className="hv-quality-chip" data-grade="poor">Out of plausible range</span>
              )}
            </div>
          </div>

          {reportLoading && (
            <div className="hv-report">
              <div className="hv-analyzing">
                <div className="hv-analyzing-bars">
                  <span /><span /><span /><span /><span /><span /><span />
                </div>
                <div className="hv-analyzing-label">Writing your report...</div>
                <div className="hv-analyzing-sub">GLM 5.1 is interpreting the signals</div>
              </div>
            </div>
          )}

          {report && !reportLoading && (
            <div className="hv-report">
              <div className="hv-report-hd">
                <span className="k">Heart report</span>
                {report.source && (
                  <span className="hv-source-chip" data-src={report.source}>
                    {report.source === 'ai' ? '● GLM 5.1' : '○ template'}
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
                  <span className="icon">§</span>
                  <div>
                    <span className="lab">When to see a GP</span>
                    <span>{report.whenToWorry}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <button className="hv-btn-ghost" onClick={startCapture}>Retake the reading</button>
        </>
      )}

      {stage === 'error' && <div className="hv-error">{error}</div>}

      <div className="hv-caveat">
        Screening only. Phone-camera heart rate has wide error bars and is not a clinical pulse. See
        a GP for any persistent symptoms — do not rely on this number alone.
      </div>

      {onBack && (
        <button className="hv-btn-ghost" onClick={onBack}>Back</button>
      )}
    </div>
  );
}
