import React, { useState } from 'react';

const css = `
  .rv-stage {
    width: 100%;
    max-width: 30rem;
    display: flex; flex-direction: column;
    gap: var(--s-4);
    margin-top: var(--s-2);
    text-align: left;
  }

  /* ========= Numbers card (physical-instrument aesthetic) ========= */
  .rv-readings {
    background: linear-gradient(180deg, rgba(26, 28, 38, 0.75), rgba(18, 19, 26, 0.5));
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5) var(--s-5) var(--s-4);
    position: relative;
    overflow: hidden;
  }
  .rv-readings::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--brass) 50%, transparent);
    opacity: 0.5;
  }
  .rv-readings-hd {
    display: flex; justify-content: space-between; align-items: baseline;
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
    margin-bottom: var(--s-4);
  }
  .rv-readings-hd .title {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: 1.6rem;
    line-height: 1;
    color: var(--bone-0);
  }
  .rv-readings-hd .id {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    color: var(--bone-3);
  }

  .rv-reading-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--s-3);
    padding: var(--s-3) 0;
    border-bottom: 1px dashed var(--hairline);
  }
  .rv-reading-row:last-of-type { border-bottom: none; }
  .rv-reading-row .key {
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .rv-reading-row .val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: clamp(1rem, 5vw, 1.8rem);
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--bone-0);
    line-height: 1;
  }
  .rv-reading-row .val .unit {
    font-size: 0.8rem;
    color: var(--bone-3);
    margin-left: 0.3rem;
    letter-spacing: 0.08em;
  }
  .rv-reading-row .pct {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
    color: var(--brass);
    letter-spacing: -0.01em;
    text-align: right;
    white-space: nowrap;
  }
  .rv-reading-row .pct .small { font-size: 0.65rem; color: var(--bone-3); margin-left: 0.25rem; letter-spacing: 0.14em; text-transform: uppercase; }

  .rv-ratio {
    margin-top: var(--s-3);
    padding-top: var(--s-3);
    border-top: 1px solid var(--hairline);
    display: flex; justify-content: space-between; align-items: baseline;
  }
  .rv-ratio .key {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .rv-ratio .val {
    font-family: var(--font-mono);
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--bone-0);
  }

  .rv-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-4);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-sm);
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }
  .rv-badge[data-level="normal"] {
    background: var(--pulse-dim);
    color: var(--pulse-bright);
    border: 1px solid rgba(123, 193, 150, 0.3);
  }
  .rv-badge[data-level="weak"] {
    background: var(--warn-dim);
    color: #f0c4c8;
    border: 1px solid rgba(209, 133, 137, 0.35);
  }
  .rv-badge[data-level="strong"] {
    background: rgba(231, 184, 126, 0.12);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }
  .rv-badge .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 10px currentColor;
  }

  .rv-ats {
    margin-top: var(--s-3);
    display: flex; flex-wrap: wrap; gap: var(--s-2);
  }
  .rv-ats-chip {
    padding: 0.25rem var(--s-2);
    border-radius: var(--r-pill);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .rv-ats-chip[data-kind="pass"] {
    background: var(--pulse-dim);
    color: var(--pulse-bright);
    border: 1px solid rgba(123, 193, 150, 0.3);
  }
  .rv-ats-chip[data-kind="flag"] {
    background: rgba(231, 184, 126, 0.1);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }

  /* ========= Personal report ========= */
  .rv-report {
    background:
      radial-gradient(ellipse at top left, rgba(231, 184, 126, 0.08), transparent 60%),
      var(--ink-2);
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-5);
    display: flex; flex-direction: column; gap: var(--s-4);
    position: relative;
    overflow: hidden;
  }
  .rv-report::before {
    content: '';
    position: absolute; inset: 0;
    pointer-events: none;
    background-image: url("data:image/svg+xml;utf8,<svg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
    opacity: 0.03;
    mix-blend-mode: overlay;
  }
  .rv-report > * { position: relative; }
  .rv-report-hd {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .rv-report-hd .k {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .rv-source-chip {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-pill);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .rv-source-chip[data-src="ai"] {
    background: rgba(231, 184, 126, 0.12);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }
  .rv-source-chip[data-src="fallback"] {
    background: rgba(209, 133, 137, 0.08);
    color: var(--warn);
    border: 1px solid rgba(209, 133, 137, 0.2);
  }

  .rv-report .headline {
    font-family: var(--font-display);
    font-weight: 400;
    
    font-size: 1.65rem;
    line-height: 1.15;
    letter-spacing: -0.015em;
    color: var(--bone-0);
    margin: 0;
  }
  .rv-report .interpretation {
    font-family: var(--font-body);
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--bone-1);
    margin: 0;
  }

  .rv-actions-label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--bone-3);
    display: flex; align-items: center; gap: var(--s-2);
    margin: 0;
  }
  .rv-actions-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--hairline);
  }
  .rv-actions {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex; flex-direction: column;
    gap: var(--s-3);
    counter-reset: action;
  }
  .rv-action {
    display: grid;
    grid-template-columns: 2rem 1fr;
    gap: var(--s-3);
    align-items: start;
    line-height: 1.5;
  }
  .rv-action .num {
    font-family: var(--font-display);
    
    font-size: 1.35rem;
    color: var(--brass);
    line-height: 1;
    margin-top: 0.1rem;
  }
  .rv-action .t {
    display: block;
    font-family: var(--font-body);
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--bone-0);
    margin-bottom: 0.2rem;
  }
  .rv-action .d {
    display: block;
    font-size: 0.85rem;
    color: var(--bone-2);
    line-height: 1.5;
  }

  .rv-worry {
    margin-top: var(--s-2);
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-3);
    background: rgba(231, 184, 126, 0.08);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-sm);
    color: var(--bone-1);
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .rv-worry .icon {
    font-family: var(--font-display);
    
    font-size: 1.3rem;
    color: var(--brass-bright);
    line-height: 1;
  }
  .rv-worry .lab {
    display: block;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--brass-bright);
    margin-bottom: 0.2rem;
  }

  /* ========= Secondary actions row ========= */
  .rv-neuro-cta {
    appearance: none;
    width: 100%;
    padding: 1rem var(--s-4);
    border: 1px solid var(--brass);
    border-radius: var(--r-sm);
    background: linear-gradient(90deg, rgba(201, 169, 110, 0.08), rgba(231, 184, 126, 0.12));
    color: var(--brass-bright);
    font-family: var(--font-body);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--s-3);
    transition: all 0.15s;
  }
  .rv-neuro-cta:hover {
    background: linear-gradient(90deg, rgba(201, 169, 110, 0.15), rgba(231, 184, 126, 0.2));
    box-shadow: var(--shadow-brass);
  }
  .rv-neuro-cta:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
  .rv-neuro-cta .arrow {
    font-family: var(--font-display);
    
    font-size: 1.15rem;
    text-transform: none;
    letter-spacing: 0;
  }

  .rv-ghost {
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
    transition: all 0.15s;
  }
  .rv-ghost:hover { color: var(--bone-0); border-color: var(--bone-2); }

  .rv-action-row {
    display: flex; flex-direction: column; gap: var(--s-2);
    margin-top: var(--s-2);
  }

  /* ========= Coaching card (invalid blow) ========= */
  .rv-coaching {
    width: 100%;
    max-width: 26rem;
    margin-top: var(--s-2);
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .rv-coaching-card {
    padding: var(--s-5);
    background: rgba(231, 184, 126, 0.08);
    border: 1px solid var(--brass-line);
    border-radius: var(--r-lg);
    color: var(--bone-0);
    text-align: center;
  }
  .rv-coaching-card .lab {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
    margin-bottom: var(--s-2);
  }
  .rv-coaching-card .msg {
    font-family: var(--font-display);
    
    font-size: 1.3rem;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }

  .rv-ref-note {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--bone-3);
    line-height: 1.5;
    padding: var(--s-3) 0;
    border-top: 1px solid var(--hairline);
    letter-spacing: 0.02em;
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

export function CoachingCard({ message, onRetry, onStartOver }) {
  useCss();
  return (
    <div className="rv-coaching">
      <div className="rv-coaching-card">
        <div className="lab">Try again</div>
        <p className="msg">{message || 'That did not look like a valid blow.'}</p>
      </div>
      <div className="rv-action-row">
        <button className="rv-neuro-cta" onClick={onRetry}>
          <span>Have another go</span><span className="arrow">→</span>
        </button>
        {onStartOver && (
          <button className="rv-ghost" onClick={onStartOver}>Edit my details</button>
        )}
      </div>
    </div>
  );
}

function caseId() {
  const d = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const ddmm = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `RSN·${ddmm}·${hhmm}`;
}

export default function ResultsView({ estimate, analysis, completed, onRetry, onStartOver, onNeuro, onHeart, onHistory }) {
  useCss();
  const [caseIdVal] = useState(caseId);
  const format = (value, decimals) => Number.isFinite(value) ? value.toFixed(decimals) : 'Unavailable';

  return (
    <div className="rv-stage">
      {/* Numbers instrument card */}
      <div className="rv-readings">
        <div className="rv-readings-hd">
          <span className="title">Your reading</span>
          <span className="id">{caseIdVal}</span>
        </div>
        <div className="rv-reading-row">
          <span className="key">Sound duration above relative threshold</span>
          <span className="val">{format(estimate.activeSec10, 2)}<span className="unit">{Number.isFinite(estimate.activeSec10) ? 's' : ''}</span></span>
        </div>
        <div className="rv-reading-row">
          <span className="key">Sound level</span>
          <span className="val">{format(estimate.rmsEnergy, 4)}<span className="unit">RMS</span></span>
        </div>
        <div className="rv-reading-row">
          <span className="key">Peak sound envelope</span>
          <span className="val">{format(estimate.peakEnv, 4)}</span>
        </div>
      </div>

      {/* Personal report */}
      {analysis?.personalReport && (
        <div className="rv-report">
          <div className="rv-report-hd">
            <span className="k">Personal report</span>
            {analysis.personalReport.source && (
              <span
                className="rv-source-chip"
                data-src={analysis.personalReport.source === 'codex' ? 'ai' : 'fallback'}
                title={analysis.personalReport.source === 'codex' ? 'Generated with a Codex model' : 'Local report'}
              >
                {analysis.personalReport.source === 'codex' ? '● Codex model' : '○ local report'}
              </span>
            )}
          </div>
          <p className="headline">{analysis.personalReport.headline}</p>
          {analysis.personalReport.interpretation && (
            <p className="interpretation">{analysis.personalReport.interpretation}</p>
          )}
          {analysis.personalReport.body && !analysis.personalReport.interpretation && (
            <p className="interpretation">{analysis.personalReport.body}</p>
          )}
          {Array.isArray(analysis.personalReport.actions) && analysis.personalReport.actions.length > 0 && (
            <>
              <p className="rv-actions-label">What to do next</p>
              <ul className="rv-actions">
                {analysis.personalReport.actions.map((a, i) => (
                  <li className="rv-action" key={i}>
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
        </div>
      )}

      <p className="rv-ref-note">
        These experimental sound values depend on your phone and surroundings. They are not lung measurements or a medical assessment.
      </p>

      <div className="rv-action-row">
        {(!completed?.neuro || !completed?.heart) && <p className="rv-ref-note">Keep going: try your remaining modules.</p>}
        {completed?.neuro && completed?.heart && <p className="rv-ref-note">You have tried all three modules.</p>}
        {onNeuro && !completed?.neuro && (
          <button className="rv-neuro-cta" onClick={onNeuro}>
            <span>Try the Neuro screen</span>
            <span className="arrow">→</span>
          </button>
        )}
        {onHeart && !completed?.heart && (
          <button className="rv-neuro-cta" onClick={onHeart}>
            <span>Try the Heart screen</span>
            <span className="arrow">→</span>
          </button>
        )}
        {onHistory && (
          <button className="rv-history-cta rv-neuro-cta" onClick={onHistory}>
            <span>Your history</span>
            <span className="arrow">→</span>
          </button>
        )}
        <button className="rv-ghost" onClick={onRetry}>Blow again</button>
        {onStartOver && (
          <button className="rv-ghost" onClick={onStartOver}>Edit my details</button>
        )}
      </div>
    </div>
  );
}
