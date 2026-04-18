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
  .nv-report-loading {
    display: flex; align-items: center; gap: var(--s-3);
    padding: var(--s-4); font-size: 0.85rem; color: var(--bone-2);
  }
  .nv-report-loading .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--brass); animation: nv-pulse 1.2s ease-in-out infinite;
  }
  @keyframes nv-pulse { 0%,100%{ opacity: 0.4; transform: scale(1);} 50%{ opacity: 1; transform: scale(1.4);} }

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

// Use the already-unlocked AudioContext singleton from recorder.js so iOS
// Safari plays the beep even 5+ seconds after the user tap (we cannot create
// a new AudioContext once the gesture window expires, but we CAN play tones
// on an existing one that was unlocked at tap time).
function buzz({ kind }) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'start' ? [120, 60, 120] : [240]);
    }
  } catch { /* ignore */ }
  try {
    const ctx = getAudioContext(); // throws if not unlocked yet
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Start: two beeps (880 Hz + 1100 Hz) so iOS/Android clearly know the test began.
    // End: single longer tone (523 Hz).
    if (kind === 'start') {
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1100, now + 0.16);
    } else {
      osc.frequency.setValueAtTime(523, now);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'start' ? 0.32 : 0.4));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (kind === 'start' ? 0.34 : 0.42));
  } catch (err) {
    console.warn('[buzz] audio blocked:', err?.message);
  }
}

const TREMOR_LABELS = {
  physiological: 'Expected adult pattern',
  essential_like: 'Higher-frequency signal',
  parkinsonian_like: 'Low-frequency signal · see GP',
};

export default function NeuroView({ onBack, demographics }) {
  useCss();
  const [stage, setStage] = useState('intro');
  const [progress, setProgress] = useState(0);
  const [prepCount, setPrepCount] = useState(0);
  const [tremor, setTremor] = useState(null);
  const [gait, setGait] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

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

  async function runTremor() {
    setStage('tremor_prep');
    setPrepCount(PREP_SECONDS);
    await prep(PREP_SECONDS, setPrepCount);
    buzz({ kind: 'start' });
    setStage('tremor_record');
    setProgress(0);
    const motion = await captureMotion({ durationMs: 10000, onTick: ({ pct }) => setProgress(pct) });
    buzz({ kind: 'end' });
    const result = analyseTremor(motion);
    setTremor(result);
    setStage('tremor_done');
  }

  async function runGait() {
    setStage('gait_prep');
    setPrepCount(PREP_SECONDS);
    await prep(PREP_SECONDS, setPrepCount);
    buzz({ kind: 'start' });
    setStage('gait_record');
    setProgress(0);
    const motion = await captureMotion({ durationMs: 10000, onTick: ({ pct }) => setProgress(pct) });
    buzz({ kind: 'end' });
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
          <button className="nv-btn" onClick={() => ensurePermissionAndRun(runTremor)}>
            <span>Start stillness test</span>
            <span className="arrow">→</span>
          </button>
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
          <div className="nv-report-loading">
            <span className="dot" />
            Building your personalised Neuro report...
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

      {onBack && (
        <button className="nv-btn-ghost" onClick={onBack}>Back to your reading</button>
      )}
    </div>
  );
}
