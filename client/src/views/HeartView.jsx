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
  .hv-analyzing-bars {
    display: flex; gap: 5px;
    align-items: flex-end;
    height: 48px;
  }
  .hv-analyzing-bars span {
    display: block;
    width: 4px;
    background: var(--warn);
    border-radius: 1px;
    animation: hv-wave 1.1s ease-in-out infinite;
  }
  .hv-analyzing-bars span:nth-child(1) { animation-delay: 0s; }
  .hv-analyzing-bars span:nth-child(2) { animation-delay: 0.08s; }
  .hv-analyzing-bars span:nth-child(3) { animation-delay: 0.16s; }
  .hv-analyzing-bars span:nth-child(4) { animation-delay: 0.24s; }
  .hv-analyzing-bars span:nth-child(5) { animation-delay: 0.32s; }
  .hv-analyzing-bars span:nth-child(6) { animation-delay: 0.4s; }
  .hv-analyzing-bars span:nth-child(7) { animation-delay: 0.48s; }
  @keyframes hv-wave {
    0%, 100% { height: 8px; opacity: 0.55; }
    50%      { height: 48px; opacity: 1; }
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
const CAPTURE_MS = 30000;
const MAX_FACE_RETRIES = 3;

async function prep(seconds, onTick) {
  for (let s = seconds; s > 0; s--) {
    onTick(s);
    await new Promise((r) => setTimeout(r, 1000));
  }
  onTick(0);
}

export default function HeartView({ onBack, demographics }) {
  useCss();
  const [stage, setStage] = useState('intro');
  const [prepCount, setPrepCount] = useState(PREP_SECONDS);
  const [progress, setProgress] = useState(0);
  const [liveHr, setLiveHr] = useState(null);
  const [faceRetries, setFaceRetries] = useState(0);
  const [classified, setClassified] = useState(null);
  const [report, setReport] = useState(null);
  const [coachingMessage, setCoachingMessage] = useState(null);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  async function startStream() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  }

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function runCapture(initialAttempt = 0) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setError(null);
    setClassified(null);
    setReport(null);
    setCoachingMessage(null);
    setFaceRetries(initialAttempt);
    setStage('prep');
    setPrepCount(PREP_SECONDS);

    try {
      await acquireCameraPermission();
      if (signal.aborted) return;
      await startStream();
      if (signal.aborted) return;
      await prep(PREP_SECONDS, setPrepCount);
      if (signal.aborted) return;

      // Detect face on the first usable frame.
      let det = await detectFirstFrameRoi(videoRef.current);
      let attempt = initialAttempt;
      while (det.kind === 'no-face' && attempt < MAX_FACE_RETRIES - 1 && !signal.aborted) {
        attempt++;
        if (mountedRef.current) setFaceRetries(attempt);
        await new Promise((r) => setTimeout(r, 700));
        det = await detectFirstFrameRoi(videoRef.current);
      }
      if (signal.aborted) return;
      const rois = det.kind === 'face'
        ? det.rois
        : buildFallbackRois(videoRef.current).rois;

      setStage('record');
      setProgress(0);
      setLiveHr(null);
      const cap = await captureRppg({
        videoEl: videoRef.current,
        durationMs: CAPTURE_MS,
        rois,
        onTick: ({ pct }) => { if (mountedRef.current) setProgress(pct); },
        onLiveHr: (bpm) => { if (mountedRef.current) setLiveHr(bpm); },
        signal,
      });

      stopStream();
      if (!mountedRef.current || signal.aborted) return;
      setStage('analyzing');

      const features = extractHeartFeatures({ samples: cap.samples, durationSec: cap.durationSec });
      if (cap.roiSource === 'fallback' && !features.reasons.includes('fallback_roi')) {
        features.reasons.push('fallback_roi');
        if (features.grade === 'good') features.grade = 'fair';
        else if (features.grade === 'fair') features.grade = 'poor';
      }
      const classifiedResult = classifyHeart({ features, demographics: demographics || {} });
      if (!mountedRef.current || signal.aborted) return;
      setClassified(classifiedResult);

      const apiResult = await analyzeHeart({ heart: classifiedResult, demographics: demographics || {} });
      if (!mountedRef.current || signal.aborted) return;
      if (apiResult.ok === false) {
        setCoachingMessage(apiResult.coaching?.message || 'Try again in better light.');
        setStage('coaching');
        return;
      }
      setReport(apiResult.report);
      setStage('result');
    } catch (e) {
      if (e?.name === 'AbortError' || signal.aborted) return;
      console.error('[heart] capture failed', e);
      stopStream();
      if (!mountedRef.current) return;
      setError(e.message || String(e));
      setStage('error');
    }
  }

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
          <button className="hv-btn" onClick={() => runCapture(0)}>
            <span>Start heart screen</span>
            <span>→</span>
          </button>
        </section>
      )}

      {(stage === 'prep' || stage === 'record') && (
        <section className="hv-step" data-state="active">
          <div className="hv-video-wrap">
            <video ref={videoRef} className="hv-video" playsInline muted />
            <div className="hv-oval" />
            {stage === 'record' && liveHr != null && (
              <div className="hv-live-hr">~ {Math.round(liveHr)} bpm</div>
            )}
          </div>
          {stage === 'prep' && (
            <>
              <div className="hv-count">{prepCount}</div>
              <p className="hv-step-desc">Centre your face in the oval. {faceRetries > 0 ? `Re-detecting (${faceRetries}/${MAX_FACE_RETRIES})…` : 'Hold steady.'}</p>
            </>
          )}
          {stage === 'record' && (
            <>
              <div className="hv-progress"><div className="hv-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
              <p className="hv-step-desc">Recording · stay still and breathe normally. {Math.max(0, Math.ceil((1 - progress) * (CAPTURE_MS / 1000)))} s left.</p>
            </>
          )}
        </section>
      )}

      {stage === 'analyzing' && (
        <div className="hv-analyzing">
          <div className="hv-analyzing-bars">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div className="hv-analyzing-label">Reading the pulse...</div>
        </div>
      )}

      {stage === 'coaching' && (
        <CoachingCard
          message={coachingMessage}
          onRetry={() => { setStage('intro'); }}
          onStartOver={onBack}
        />
      )}

      {stage === 'result' && classified && (
        <>
          <section className="hv-step" data-state="done">
            <div className="hv-result-row">
              <span className="k">Resting heart rate</span>
              <span className="v">{Math.round(classified.hrBpm)} bpm</span>
            </div>
            <div className="hv-result-row">
              <span className="k">HRV · RMSSD</span>
              <span className="v">{classified.hrvRmssdMs != null ? `${classified.hrvRmssdMs.toFixed(0)} ms` : '-'}</span>
            </div>
            <div className="hv-result-row">
              <span className="k">HRV · SDNN</span>
              <span className="v">{classified.sdnnMs != null ? `${classified.sdnnMs.toFixed(0)} ms` : '-'}</span>
            </div>
            <div className="hv-result-row">
              <span className="k">Beats detected</span>
              <span className="v">{classified.beatCount}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', marginTop: 'var(--s-2)' }}>
              <span className="hv-chip" data-k={classified.hrClassification}>
                {classified.hrClassification === 'normal' ? 'Within typical range'
                  : classified.hrClassification === 'tachycardia' ? 'Above typical range'
                  : classified.hrClassification === 'bradycardia' ? 'Below typical range'
                  : 'Reading'}
              </span>
              {classified.quality?.reasons?.includes('fallback_roi') && (
                <span className="hv-chip" data-k="fallback">Read wider patch</span>
              )}
            </div>
          </section>

          {report && (
            <div className="hv-report">
              <p className="headline">{report.headline}</p>
              {report.interpretation && <p className="interp">{report.interpretation}</p>}
              {Array.isArray(report.actions) && (
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
              )}
              {report.whenToWorry && (
                <div className="hv-worry"><strong>When to see a GP. </strong>{report.whenToWorry}</div>
              )}
            </div>
          )}

          <button className="hv-btn-ghost" onClick={() => runCapture(0)}>Retake the reading</button>
        </>
      )}

      {stage === 'error' && (
        <div className="hv-error">{error || 'Something went wrong with the heart screen.'}</div>
      )}

      {onBack && stage !== 'record' && stage !== 'prep' && (
        <button className="hv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
    </div>
  );
}
