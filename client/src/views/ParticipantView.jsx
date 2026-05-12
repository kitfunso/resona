import React, { useState, useRef } from 'react';
import { unlockAudio, acquireMicPermission, recordBlow } from '../audio/recorder.js';
import { extractFeatures } from '../audio/features.js';
import { estimateSpirometry } from '../audio/regression.js';
import { analyzeBlow } from '../api.js';
import OnboardingView from './OnboardingView.jsx';
import ResultsView, { CoachingCard } from './ResultsView.jsx';
import NeuroView from './NeuroView.jsx';
import HeartView from './HeartView.jsx';

const DURATION_MS = 6000;

const css = `
  .r-stage {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: calc(5rem + env(safe-area-inset-top, 0)) var(--s-4) calc(8rem + env(safe-area-inset-bottom, 0));
    gap: var(--s-4);
    text-align: center;
    position: relative;
  }

  /* ===== Top brand bar (replaces the old disclaimer-as-header) ===== */
  .r-chrome {
    position: fixed; top: 0; left: 0; right: 0;
    padding: calc(var(--s-3) + env(safe-area-inset-top, 0)) var(--s-4) var(--s-3);
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--s-3);
    background: linear-gradient(to bottom, rgba(18, 19, 26, 0.92), rgba(18, 19, 26, 0.72) 80%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--hairline);
    z-index: 20;
  }
  .r-chrome-brand {
    display: flex; align-items: baseline; gap: var(--s-2);
  }
  .r-chrome-brand .codename {
    font-family: var(--font-display);
    
    font-size: 1.15rem;
    color: var(--bone-1);
    line-height: 1;
    opacity: 0.85;
  }
  .r-chrome-brand .codename .paren {
    color: var(--brass);
    font-style: normal;
    font-family: var(--font-body);
    font-size: 0.75em;
    margin: 0 0.15em;
    vertical-align: 0.1em;
  }
  .r-chrome-disclaimer {
    font-size: 0.68rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--bone-3);
    text-align: right;
    line-height: 1.4;
    max-width: 12rem;
  }

  /* ===== Hero block ===== */
  .r-hero {
    display: flex; flex-direction: column; align-items: center;
    gap: var(--s-1);
    margin-bottom: var(--s-2);
  }
  .r-hero-title {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: clamp(2.4rem, 9vw, 3.6rem);
    line-height: 0.95;
    margin: 0;
    letter-spacing: -0.02em;
    color: var(--bone-0);
  }
  .r-hero-tagline {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: clamp(0.95rem, 2.4vw, 1.2rem);
    line-height: 1.25;
    color: var(--bone-2);
    margin: var(--s-1) 0 0;
    letter-spacing: 0;
  }
  .r-hero-tagline .brass { color: var(--brass); }
  .r-hero-module {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-2);
    padding: var(--s-1) var(--s-3);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-pill);
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--bone-1);
    background: rgba(201, 169, 110, 0.06);
  }
  .r-hero-module .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--brass);
    box-shadow: 0 0 10px var(--brass-glow);
    animation: r-dot 2.2s ease-in-out infinite;
  }
  @keyframes r-dot { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }

  /* ===== The instrument (blow circle) ===== */
  .r-instrument {
    position: relative;
    width: min(78vw, 320px);
    height: min(78vw, 320px);
    display: flex; align-items: center; justify-content: center;
    margin-top: var(--s-3);
  }
  .r-instrument-ring {
    position: absolute; inset: 0;
    border-radius: 50%;
    border: 1px solid var(--brass-line);
  }
  .r-instrument-ring::before,
  .r-instrument-ring::after {
    content: '';
    position: absolute; inset: 8px;
    border-radius: 50%;
    border: 1px dashed var(--brass-line);
    opacity: 0.5;
  }
  .r-instrument-ring::after {
    inset: 20px;
    border-style: solid;
    opacity: 0.3;
  }
  .r-ticks-ring {
    position: absolute; inset: -10px;
    pointer-events: none;
  }
  .r-ticks-ring svg { width: 100%; height: 100%; }
  .r-ticks-ring line { stroke: var(--brass); stroke-width: 1; opacity: 0.55; }
  .r-ticks-ring line.major { stroke-width: 2; opacity: 0.9; }

  .r-blow {
    appearance: none; border: none; cursor: pointer;
    width: 76%; height: 76%;
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 30%, #2e3141 0%, #1a1c26 55%, #111218 100%);
    color: var(--bone-0);
    font-family: var(--font-body);
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    transition: transform 0.15s ease, box-shadow 0.25s ease;
    box-shadow:
      inset 0 1px 0 rgba(244, 236, 225, 0.08),
      inset 0 -8px 18px rgba(0, 0, 0, 0.5),
      0 18px 40px rgba(0, 0, 0, 0.55),
      0 0 0 1px var(--brass-line);
    position: relative;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--s-1);
  }
  .r-blow:active { transform: scale(0.98); }
  .r-blow:disabled { opacity: 0.7; cursor: not-allowed; }
  .r-blow[data-recording="true"] {
    background:
      radial-gradient(circle at 35% 30%, #5a3826 0%, #3a1f14 55%, #1a0c07 100%);
    color: var(--bone-0);
    animation: r-pulse 1.2s ease-in-out infinite;
    box-shadow:
      inset 0 1px 0 rgba(231, 184, 126, 0.2),
      inset 0 -12px 28px rgba(0, 0, 0, 0.55),
      0 18px 40px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(231, 184, 126, 0.45),
      0 0 60px rgba(231, 184, 126, 0.22);
  }
  @keyframes r-pulse {
    0%, 100% { transform: scale(1); box-shadow: inset 0 1px 0 rgba(231, 184, 126, 0.2), inset 0 -12px 28px rgba(0, 0, 0, 0.55), 0 18px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(231, 184, 126, 0.45), 0 0 40px rgba(231, 184, 126, 0.18); }
    50%       { transform: scale(1.02); box-shadow: inset 0 1px 0 rgba(231, 184, 126, 0.2), inset 0 -12px 28px rgba(0, 0, 0, 0.55), 0 18px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(231, 184, 126, 0.6), 0 0 80px rgba(231, 184, 126, 0.32); }
  }
  .r-blow .action {
    font-family: var(--font-body);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    color: var(--brass);
  }
  .r-blow .prompt {
    font-family: var(--font-display);
    
    font-size: clamp(1.6rem, 5vw, 2rem);
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--bone-0);
  }

  .r-countdown {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: clamp(5rem, 22vw, 8rem);
    line-height: 0.9;
    letter-spacing: -0.04em;
    color: var(--bone-0);
    text-shadow: 0 0 40px rgba(231, 184, 126, 0.35);
  }
  .r-countdown-unit {
    font-size: 0.7rem;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--brass);
    margin-top: var(--s-1);
  }

  /* ===== Hint, copy block under the instrument ===== */
  .r-hint {
    max-width: 28rem;
    font-size: var(--t-small);
    line-height: 1.55;
    color: var(--bone-2);
    margin: var(--s-3) 0 0;
    padding: 0 var(--s-2);
  }
  .r-hint strong {
    color: var(--bone-0);
    font-weight: 600;
  }

  /* ===== Level meter (during recording) ===== */
  .r-meter {
    width: min(85vw, 340px);
    margin-top: var(--s-3);
    display: flex; flex-direction: column; gap: var(--s-2);
  }
  .r-meter-bar {
    position: relative;
    height: 14px;
    background: rgba(244, 236, 225, 0.05);
    border: 1px solid var(--hairline);
    border-radius: 2px;
    overflow: hidden;
  }
  .r-meter-bar::before {
    content: '';
    position: absolute; inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(10% - 1px),
      rgba(244, 236, 225, 0.12) calc(10% - 1px),
      rgba(244, 236, 225, 0.12) 10%
    );
    z-index: 2;
  }
  .r-meter-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--pulse) 0%, var(--signal) 55%, var(--brass-bright) 80%, var(--warn) 100%);
    width: 0%;
    transition: width 0.06s linear;
    box-shadow: 0 0 12px rgba(231, 184, 126, 0.35);
  }
  .r-meter-legend {
    display: flex; justify-content: space-between; font-family: var(--font-mono);
    font-size: 0.65rem; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--bone-3);
  }
  .r-meter-legend[data-live="true"] {
    color: var(--brass);
  }
  .r-meter-legend[data-live="true"] .dot {
    background: var(--brass);
    box-shadow: 0 0 8px var(--brass-glow);
  }
  .r-meter-legend .dot {
    display: inline-block;
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--bone-3);
    margin-right: 0.4em;
    vertical-align: middle;
  }

  /* ===== Back link ===== */
  .r-back {
    appearance: none; background: transparent; border: none;
    color: var(--bone-3);
    font-family: var(--font-body);
    font-size: 0.72rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    cursor: pointer;
    padding: var(--s-3);
    margin-top: var(--s-3);
    transition: color 0.15s;
  }
  .r-back:hover { color: var(--brass); }

  /* ===== Analyzing state ===== */
  .r-analyzing {
    display: flex; flex-direction: column; align-items: center;
    gap: var(--s-4);
    padding: var(--s-6) 0;
  }
  .r-analyzing-bars {
    display: flex; gap: 5px;
    align-items: flex-end;
    height: 48px;
  }
  .r-analyzing-bars span {
    display: block;
    width: 4px;
    background: var(--brass);
    border-radius: 1px;
    animation: r-wave 1.1s ease-in-out infinite;
  }
  .r-analyzing-bars span:nth-child(1) { animation-delay: 0s; }
  .r-analyzing-bars span:nth-child(2) { animation-delay: 0.08s; }
  .r-analyzing-bars span:nth-child(3) { animation-delay: 0.16s; }
  .r-analyzing-bars span:nth-child(4) { animation-delay: 0.24s; }
  .r-analyzing-bars span:nth-child(5) { animation-delay: 0.32s; }
  .r-analyzing-bars span:nth-child(6) { animation-delay: 0.4s; }
  .r-analyzing-bars span:nth-child(7) { animation-delay: 0.48s; }
  @keyframes r-wave {
    0%, 100% { height: 8px; opacity: 0.55; }
    50%      { height: 48px; opacity: 1; }
  }
  .r-analyzing-label {
    font-family: var(--font-display);
    
    font-size: var(--t-h3);
    color: var(--bone-1);
  }
  .r-analyzing-sub {
    font-size: 0.72rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--bone-3);
  }

  /* ===== Error state ===== */
  .r-error {
    margin-top: var(--s-4);
    padding: var(--s-4) var(--s-4);
    background: var(--warn-dim);
    border: 1px solid rgba(209, 133, 137, 0.3);
    color: #f3c7c8;
    border-radius: var(--r-sm);
    font-size: var(--t-small);
    max-width: 26rem;
    line-height: 1.5;
  }

  /* ===== Mic arrow hint ===== */
  /* Hint container spans full bottom. Label is always centered above; the
     arrow is positioned absolutely at the platform-specific mic location. */
  .r-mic-hint {
    position: fixed;
    left: 0; right: 0;
    bottom: calc(0.75rem + env(safe-area-inset-bottom, 0));
    height: 5.25rem;
    pointer-events: none;
    z-index: 10;
  }
  .r-mic-hint .r-mic-hint-label {
    position: absolute;
    left: 0; right: 0;
    bottom: 2.75rem;
    margin: 0 auto;
    width: fit-content;
    text-align: center;
  }
  /* Arrow always points to the bottom-centre. iPhone mics are nominally
     bottom-left of the charging port, but in practice the phone is held
     close enough to the mouth that centre-aim captures the sound reliably
     on every device. Matches real blowing technique better than spec-accurate
     placement. margin-left of -14px (half the triangle's 28px base) instead
     of transform: translateX so the bounce translateY animation survives. */
  .r-mic-hint .r-mic-arrow {
    position: absolute;
    bottom: 0;
    left: 50%;
    margin-left: -14px;
  }
  .r-mic-hint-label {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
    padding: var(--s-1) var(--s-3);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-pill);
    background: rgba(18, 19, 26, 0.8);
    backdrop-filter: blur(6px);
  }
  .r-mic-arrow {
    width: 0; height: 0;
    border-left: 14px solid transparent;
    border-right: 14px solid transparent;
    border-top: 22px solid var(--brass);
    filter: drop-shadow(0 0 10px var(--brass-glow));
    animation: r-arrow 1.2s ease-in-out infinite;
  }
  @keyframes r-arrow {
    0%, 100% { transform: translateY(0); opacity: 0.8; }
    50%      { transform: translateY(6px); opacity: 1; }
  }
  .r-mic-hint[data-active="true"] .r-mic-arrow {
    border-top-color: var(--warn);
    filter: drop-shadow(0 0 12px rgba(209, 133, 137, 0.55));
  }
  .r-mic-hint[data-active="true"] .r-mic-hint-label {
    color: var(--warn);
    border-color: rgba(209, 133, 137, 0.4);
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

// Last-resort client-side fallback when the server can't be reached at all
// (network down, ngrok dropped, fetch timed out). Mirrors the shape of the
// server response so ResultsView renders normally. User still gets numbers +
// a plain-English report, just from a local template rather than the LLM.
function buildLocalFallback(estimate, demographics, err) {
  const pp = Math.round(estimate.percentPredicted.fev1);
  const below = pp < 80;
  const above = pp > 115;
  const headline = below
    ? 'Your FEV1 came in lower than expected.'
    : above
    ? 'Your FEV1 came in above the expected range.'
    : 'Your FEV1 is roughly in line with expectations.';
  const interpretation =
    `You pushed out ${estimate.fev1.toFixed(2)} L in the first second, ${estimate.fvc.toFixed(2)} L in total, ` +
    `with a peak flow of ${estimate.pef.toFixed(2)} L/s. That is ${pp}% of the expected value for someone your ` +
    `age, sex, and height.`;
  const actions = below
    ? [
        { title: 'Book a GP appointment', detail: 'Mention these numbers and ask about formal spirometry.' },
        { title: 'Skip smoking and vaping', detail: 'These are the fastest way to push FEV1 down further.' },
        { title: 'Track any new symptoms', detail: 'Note morning cough, wheeze, or breathlessness for your GP.' },
      ]
    : above
    ? [
        { title: 'Keep doing what you are doing', detail: 'Regular cardio and healthy weight keep you here.' },
        { title: 'Do not start smoking', detail: 'That is the quickest way to lose this margin within a few years.' },
        { title: 'Treat this as a screening', detail: 'Real clinical spirometry may read 10 to 15% lower.' },
      ]
    : [
        { title: 'Get 150 minutes of cardio a week', detail: 'Brisk walking, cycling, swimming keep lung capacity up.' },
        { title: 'Avoid smoking and vaping', detail: 'Even a few years of smoking shifts FEV1 trajectory.' },
        { title: 'Re-check once a year', detail: 'An annual screen helps spot trends early.' },
      ];
  const personalReport = {
    headline,
    interpretation,
    actions,
    whenToWorry: below
      ? 'See a GP if you develop new shortness of breath, chest tightness, a persistent cough, or wheezing.'
      : 'See a GP if you notice sudden shortness of breath or a cough that lasts more than three weeks.',
    source: 'fallback',
  };

  const name = demographics?.name?.trim() || 'This individual';
  const gpLetter =
    `Dear GP,\n\n` +
    `${name} (${demographics?.ageYears ?? '?'}, ${demographics?.sex ?? '?'}, ${demographics?.heightCm ?? '?'} cm) ` +
    `completed a phone-based acoustic spirometry screening at a public event.\n\n` +
    `FEV1: ${estimate.fev1.toFixed(2)} L (${Math.round(estimate.percentPredicted.fev1)}% predicted)\n` +
    `FVC: ${estimate.fvc.toFixed(2)} L (${Math.round(estimate.percentPredicted.fvc)}% predicted)\n` +
    `PEF: ${estimate.pef.toFixed(2)} L/s (${Math.round(estimate.percentPredicted.pef)}% predicted)\n` +
    `FEV1/FVC ratio: ${estimate.fev1FvcRatio.toFixed(2)}\n\n` +
    `These values are derived from smartphone microphone audio using the Hankinson NHANES III reference ` +
    `equations. This is a screening tool, not clinical spirometry. Formal office spirometry is recommended ` +
    `if any concern.\n\n` +
    `Kind regards,\nResona (acoustic screening tool)`;

  return {
    valid: true,
    atsFlags: [],
    personalReport,
    gpLetter,
    gpLetterSource: 'fallback',
    offline: true,
    reason: err?.message || 'network',
  };
}

// Rough platform detection. We can reliably distinguish iOS / Android /
// desktop from the UA but cannot identify the exact phone model. Apple
// obfuscates Safari's UA and Android is too fragmented. So we point to the
// most common mic location per platform and rely on the live mic level
// meter during recording for the real feedback.
function detectPlatform() {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function InstrumentTickRing() {
  // 60 ticks around a circle (like a metronome / tachymeter bezel)
  const ticks = [];
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const major = i % 5 === 0;
    const outerR = 99;
    const innerR = major ? 93 : 96;
    const x1 = 100 + innerR * Math.cos(angle);
    const y1 = 100 + innerR * Math.sin(angle);
    const x2 = 100 + outerR * Math.cos(angle);
    const y2 = 100 + outerR * Math.sin(angle);
    ticks.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'major' : ''} />,
    );
  }
  return (
    <div className="r-ticks-ring">
      <svg viewBox="0 0 200 200" preserveAspectRatio="none">
        {ticks}
      </svg>
    </div>
  );
}

export default function ParticipantView() {
  useCss();
  const [stage, setStage] = useState('onboarding');
  const [countdown, setCountdown] = useState(0);
  const [level, setLevel] = useState(0);
  const [estimate, setEstimate] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [coachingMessage, setCoachingMessage] = useState(null);
  const [error, setError] = useState(null);
  const demographicsRef = useRef(null);

  function handleOnboardSubmit(demographics) {
    demographicsRef.current = demographics;
    setStage('blow');
  }

  async function handleArm() {
    setError(null);
    setEstimate(null);
    setAnalysis(null);
    setCoachingMessage(null);
    setLevel(0);
    try {
      unlockAudio();
      await acquireMicPermission();
      setStage('armed');
    } catch (permErr) {
      setError('Microphone permission is required. Please allow mic access and try again.');
      setStage('error');
    }
  }

  async function handleBlow() {
    try {
      // Permission already granted in handleArm; this tap is the user's
      // deliberate "go" signal so recording starts on their cue, not on
      // whatever moment the OS dialog happens to resolve.
      setStage('recording');
      setCountdown(Math.round(DURATION_MS / 1000));

      const { pcm, sampleRate } = await recordBlow({
        durationMs: DURATION_MS,
        onTick: ({ pct }) => {
          const remaining = Math.max(0, Math.ceil((1 - pct) * (DURATION_MS / 1000)));
          setCountdown(remaining);
        },
        onLevel: setLevel,
      });

      setStage('analyzing');
      setCountdown(0);

      const features = extractFeatures(pcm, sampleRate);
      const localEstimate = estimateSpirometry({ features, demographics: demographicsRef.current });
      setEstimate(localEstimate);

      let apiResult;
      try {
        apiResult = await analyzeBlow({
          features,
          estimate: localEstimate,
          demographics: demographicsRef.current,
        });
      } catch (apiErr) {
        console.error('analyze-blow failed, using client-side fallback', apiErr);
        apiResult = buildLocalFallback(localEstimate, demographicsRef.current, apiErr);
      }

      if (apiResult.valid === false) {
        setCoachingMessage(apiResult.coachingMessage);
        setStage('coaching');
        return;
      }

      setAnalysis(apiResult);
      setStage('results');
    } catch (e) {
      console.error(e);
      setError(e.message || String(e));
      setStage('error');
    }
  }

  function resetToBlow() {
    setEstimate(null);
    setAnalysis(null);
    setCoachingMessage(null);
    setError(null);
    setStage('blow');
  }

  function resetToOnboarding() {
    demographicsRef.current = null;
    resetToBlow();
    setStage('onboarding');
  }

  const recording = stage === 'recording';
  const armed = stage === 'armed';
  const disabled = stage === 'recording' || stage === 'analyzing';
  const platform = detectPlatform();
  // Desktop users have no single mic position worth pointing at, they use a
  // laptop lid or external mic. Hide the arrow there to avoid misleading cue.
  const showMicArrow = (stage === 'blow' || stage === 'armed' || stage === 'recording') && platform !== 'desktop';

  return (
    <main className="r-stage">
      <header className="r-chrome">
        <div className="r-chrome-brand">
          <span className="codename">
            <span className="paren">/</span>not-a-doctor<span className="paren">/</span>
          </span>
        </div>
        <div className="r-chrome-disclaimer">Screening tool<br />not a diagnosis</div>
      </header>

      {(stage === 'blow' || stage === 'armed' || stage === 'recording' || stage === 'analyzing' || stage === 'onboarding') && (
        <div className="r-hero">
          <h1 className="r-hero-title">Resona</h1>
          <p className="r-hero-tagline">
            Every body has <span className="brass">a rhythm.</span>
          </p>
          {stage !== 'onboarding' && (
            <div className="r-hero-module">
              <span className="dot" />
              <span>Module 01 · Breath</span>
            </div>
          )}
        </div>
      )}

      {stage === 'onboarding' && <OnboardingView onSubmit={handleOnboardSubmit} />}

      {(stage === 'blow' || stage === 'armed' || stage === 'recording') && (
        <>
          <div className="r-instrument">
            <div className="r-instrument-ring" />
            <InstrumentTickRing />
            <button
              className="r-blow"
              data-recording={recording}
              data-armed={armed}
              onClick={armed ? handleBlow : handleArm}
              disabled={disabled}
            >
              {recording ? (
                <>
                  <span className="r-countdown">{countdown}</span>
                  <span className="r-countdown-unit">seconds remaining</span>
                </>
              ) : armed ? (
                <>
                  <span className="action">Tap to blow</span>
                  <span className="prompt">Deep breath. Start when you are ready.</span>
                </>
              ) : (
                <>
                  <span className="action">Tap to begin</span>
                  <span className="prompt">Take a breath.</span>
                </>
              )}
            </button>
          </div>

          <p className="r-hint">
            Stand up. Take the deepest breath you can. Hold the bottom of the phone close to your
            mouth. Blow <strong>hard</strong> and <strong>steady</strong> for as long as you can. The
            longer you sustain strong flow, the stronger your reading.
          </p>

          {recording && (
            <div className="r-meter" aria-label="Live mic level">
              <div className="r-meter-bar">
                <div
                  className="r-meter-fill"
                  style={{ width: `${Math.min(100, level * 140)}%` }}
                />
              </div>
              <div className="r-meter-legend" data-live={level > 0.03 ? 'true' : 'false'}>
                <span>
                  <span className="dot" />
                  {level > 0.03 ? 'Signal acquired' : 'Awaiting breath'}
                </span>
                <span>{(level * 100).toFixed(0).padStart(2, '0')} dBFS</span>
              </div>
            </div>
          )}

          {(stage === 'blow' || stage === 'armed') && (
            <button className="r-back" onClick={resetToOnboarding}>
              ← Edit my details
            </button>
          )}
        </>
      )}

      {stage === 'analyzing' && (
        <div className="r-analyzing">
          <div className="r-analyzing-bars">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div className="r-analyzing-label">Listening to your rhythm...</div>
          <div className="r-analyzing-sub">GLM 5.1 is reading the waveform</div>
        </div>
      )}

      {stage === 'coaching' && (
        <CoachingCard
          message={coachingMessage}
          onRetry={resetToBlow}
          onStartOver={resetToOnboarding}
        />
      )}

      {stage === 'results' && estimate && (
        <ResultsView
          estimate={estimate}
          analysis={analysis}
          onRetry={resetToBlow}
          onStartOver={resetToOnboarding}
          onNeuro={() => setStage('neuro')}
          onHeart={() => setStage('heart')}
        />
      )}

      {stage === 'neuro' && (
        <NeuroView
          demographics={demographicsRef.current}
          onBack={() => setStage(estimate ? 'results' : 'blow')}
          onHeart={() => setStage('heart')}
        />
      )}

      {stage === 'heart' && (
        <HeartView
          demographics={demographicsRef.current}
          onBack={() => setStage(estimate ? 'results' : 'blow')}
        />
      )}

      {stage === 'error' && (
        <>
          <p className="r-error">Something went wrong: {error}</p>
          <button className="r-back" onClick={resetToBlow}>← Try again</button>
          <button className="r-back" onClick={resetToOnboarding}>← Start over</button>
        </>
      )}

      {showMicArrow && (
        <div
          className="r-mic-hint"
          data-active={stage === 'recording'}
          data-platform={platform}
        >
          <span className="r-mic-hint-label">
            {stage === 'recording'
              ? 'Keep blowing here'
              : platform === 'ios'
              ? 'Blow into bottom-left (next to charging port)'
              : 'Blow into the bottom of your phone'}
          </span>
          <div className="r-mic-arrow" />
        </div>
      )}
    </main>
  );
}
