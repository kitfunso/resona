import React, { useCallback, useEffect, useState } from 'react';

// CSS prefix is hsv- (history-view; hv- is taken by HeartView).
// Mirrors the resona convention: const css at module scope,
// cssInjected flag, useCss() hook called from the component.
const css = `
  .hsv-stage {
    width: 100%;
    max-width: min(78vw, 32rem);
    margin: 0 auto;
    display: flex; flex-direction: column;
    gap: var(--s-4);
    margin-top: var(--s-2);
    text-align: left;
  }

  /* ========= Header ========= */
  .hsv-head {
    display: flex; flex-direction: column; gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .hsv-eyebrow {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .hsv-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.8rem;
    line-height: 1;
    color: var(--bone-0);
    margin: 0;
  }
  .hsv-count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    color: var(--bone-3);
    margin: 0;
  }

  /* ========= Loading (mirrors r-analyzing / nv-analyzing) ========= */
  .hsv-loading {
    display: flex; flex-direction: column; align-items: center;
    gap: var(--s-4);
    padding: var(--s-6) 0;
  }
  .hsv-loading-bars {
    display: flex; gap: 5px;
    align-items: flex-end;
    height: 48px;
  }
  .hsv-loading-bars span {
    display: block;
    width: 4px;
    background: var(--brass);
    border-radius: 1px;
    animation: hsv-wave 1.1s ease-in-out infinite;
  }
  .hsv-loading-bars span:nth-child(1) { animation-delay: 0s; }
  .hsv-loading-bars span:nth-child(2) { animation-delay: 0.08s; }
  .hsv-loading-bars span:nth-child(3) { animation-delay: 0.16s; }
  .hsv-loading-bars span:nth-child(4) { animation-delay: 0.24s; }
  .hsv-loading-bars span:nth-child(5) { animation-delay: 0.32s; }
  .hsv-loading-bars span:nth-child(6) { animation-delay: 0.40s; }
  .hsv-loading-bars span:nth-child(7) { animation-delay: 0.48s; }
  @keyframes hsv-wave {
    0%, 100% { height: 8px; opacity: 0.55; }
    50%      { height: 48px; opacity: 1; }
  }
  .hsv-loading-label {
    font-family: var(--font-body);
    font-size: 0.72rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--bone-3);
  }

  /* ========= Empty state ========= */
  .hsv-empty {
    display: flex; flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-5) var(--s-2);
    text-align: center;
    align-items: center;
  }
  .hsv-empty-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.5rem;
    line-height: 1.2;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }
  .hsv-empty-body {
    font-family: var(--font-body);
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--bone-1);
    margin: 0;
    max-width: 28rem;
  }
  .hsv-empty-tail {
    font-family: var(--font-body);
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--bone-2);
    margin: 0;
    max-width: 28rem;
  }
  .hsv-empty-actions {
    display: flex; flex-direction: column;
    gap: var(--s-2);
    width: 100%;
    max-width: 22rem;
    margin-top: var(--s-2);
  }

  /* ========= List ========= */
  .hsv-list-section {
    display: flex; flex-direction: column;
    gap: var(--s-2);
  }
  .hsv-group-label {
    font-family: var(--font-body);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
    margin: var(--s-3) 0 var(--s-1);
  }
  .hsv-group-label[data-group="earlier"] {
    color: var(--bone-3);
  }
  .hsv-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex; flex-direction: column;
    gap: var(--s-2);
  }
  .hsv-row {
    display: flex; flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: var(--s-3) var(--s-4);
    background: linear-gradient(180deg, rgba(26, 28, 38, 0.55), rgba(18, 19, 26, 0.35));
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    position: relative;
  }
  .hsv-row-time {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
    color: var(--bone-1);
    flex: 0 0 auto;
    min-width: 3.5rem;
  }
  .hsv-modality-chip {
    flex: 0 0 auto;
    padding: 0.2rem 0.6rem;
    border-radius: var(--r-pill);
    font-family: var(--font-body);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
  .hsv-modality-chip[data-kind="breath"] {
    background: rgba(231, 184, 126, 0.12);
    color: var(--brass-bright);
    border: 1px solid var(--brass-line);
  }
  .hsv-modality-chip[data-kind="motion"] {
    background: rgba(184, 172, 148, 0.12);
    color: var(--bone-2);
    border: 1px solid var(--hairline-strong);
  }
  .hsv-modality-chip[data-kind="heart"] {
    background: var(--warn-dim);
    color: #f0c4c8;
    border: 1px solid rgba(209, 133, 137, 0.35);
  }
  .hsv-headline {
    flex: 1 1 14rem;
    min-width: 0;
    font-family: var(--font-body);
    font-size: 0.92rem;
    line-height: 1.4;
    color: var(--bone-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hsv-headline[data-missing="true"] {
    color: var(--bone-3);
    font-style: italic;
  }
  .hsv-sr {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    border: 0;
  }

  /* ========= Footer (truncated note) ========= */
  .hsv-footer {
    font-family: var(--font-body);
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--brass);
    line-height: 1.5;
    padding: var(--s-3) 0;
    border-top: 1px solid var(--hairline);
    margin-top: var(--s-2);
  }

  /* ========= Error state (mirrors nv-error) ========= */
  .hsv-error {
    display: flex; flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-4);
    background: var(--warn-dim);
    border: 1px solid rgba(209, 133, 137, 0.3);
    color: #f3c7c8;
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .hsv-error strong { color: #f9dadc; font-weight: 700; }

  /* ========= Buttons (mirror rv-neuro-cta / rv-ghost) ========= */
  .hsv-cta {
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
  .hsv-cta:hover {
    background: linear-gradient(90deg, rgba(201, 169, 110, 0.15), rgba(231, 184, 126, 0.2));
    box-shadow: var(--shadow-brass);
  }
  .hsv-cta .arrow {
    font-family: var(--font-display);
    font-size: 1.15rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .hsv-ghost {
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
  .hsv-ghost:hover { color: var(--bone-0); border-color: var(--bone-2); }

  .hsv-back-row {
    display: flex; justify-content: center;
    margin-top: var(--s-3);
  }
  .hsv-back {
    appearance: none; background: transparent; border: none;
    color: var(--bone-3);
    font-family: var(--font-body);
    font-size: 0.72rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    cursor: pointer;
    padding: var(--s-3);
    transition: color 0.15s;
  }
  .hsv-back:hover { color: var(--brass); }
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

const MODALITY_LABEL = {
  breath: 'Breath',
  motion: 'Motion',
  heart: 'Heart',
};

// Day-grouping buckets: Today, Yesterday, This week, Earlier.
// Computed in the user's local zone via Date arithmetic.
function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function groupForDate(iso, now) {
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return 'earlier';
  const today = startOfLocalDay(now);
  const createdDay = startOfLocalDay(created);
  const diffDays = Math.round((today.getTime() - createdDay.getTime()) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'this-week';
  return 'earlier';
}

const GROUP_ORDER = ['today', 'yesterday', 'this-week', 'earlier'];
const GROUP_LABEL = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  earlier: 'Earlier',
};

function formatLocalTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function HistoryView({ onBack, onBreath, onHeart }) {
  useCss();
  const [stage, setStage] = useState('loading');
  // 'loading' | 'empty' | 'list' | 'error'
  const [checkIns, setCheckIns] = useState([]);
  const [limit, setLimit] = useState(50);
  const [truncated, setTruncated] = useState(false);
  const [errorKind, setErrorKind] = useState(null);
  // null | 'auth-expired' | 'network'

  const load = useCallback(async () => {
    setStage('loading');
    setErrorKind(null);
    try {
      const res = await fetch('/api/me/check-ins?limit=50', {
        credentials: 'include',
      });
      if (res.status === 401) {
        setErrorKind('auth-expired');
        setStage('error');
        return;
      }
      if (!res.ok) {
        setErrorKind('network');
        setStage('error');
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data?.checkIns) ? data.checkIns : [];
      setCheckIns(rows);
      setLimit(typeof data?.limit === 'number' ? data.limit : 50);
      setTruncated(data?.truncated === true);
      setStage(rows.length === 0 ? 'empty' : 'list');
    } catch (_err) {
      setErrorKind('network');
      setStage('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ===== Loading =====
  if (stage === 'loading') {
    return (
      <section className="hsv-stage" aria-busy="true">
        <div className="hsv-loading">
          <div className="hsv-loading-bars" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div className="hsv-loading-label">Loading</div>
        </div>
        <div className="hsv-back-row">
          <button type="button" className="hsv-back" onClick={onBack}>Back</button>
        </div>
      </section>
    );
  }

  // ===== Error =====
  if (stage === 'error') {
    const isAuth = errorKind === 'auth-expired';
    return (
      <section className="hsv-stage">
        <div className="hsv-error" role="alert">
          {isAuth ? (
            <>
              <p style={{ margin: 0 }}>
                <strong>Your session expired.</strong> Sign in again to see your history.
              </p>
              <button type="button" className="hsv-cta" onClick={onBack}>
                <span>Sign in</span>
                <span className="arrow">{'→'}</span>
              </button>
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                <strong>Could not load your history.</strong> Check your connection and try again.
              </p>
              <button type="button" className="hsv-cta" onClick={load}>
                <span>Retry</span>
                <span className="arrow">{'→'}</span>
              </button>
            </>
          )}
        </div>
        <div className="hsv-back-row">
          <button type="button" className="hsv-back" onClick={onBack}>Back</button>
        </div>
      </section>
    );
  }

  // ===== Empty =====
  if (stage === 'empty') {
    return (
      <section className="hsv-stage">
        <div className="hsv-empty">
          <h1 className="hsv-empty-title">Your history starts here.</h1>
          <p className="hsv-empty-body">
            Every Breath, Motion, and Heart check-in you complete will be listed on this page, just for you.
            Nobody else can see this list, including your employer. The only aggregate they see is the team-level
            summary described in our privacy policy.
          </p>
          <p className="hsv-empty-tail">Take your first reading to start the record.</p>
          <div className="hsv-empty-actions">
            {onBreath && (
              <button type="button" className="hsv-cta" onClick={onBreath}>
                <span>Take a Breath reading</span>
                <span className="arrow">{'→'}</span>
              </button>
            )}
            {onHeart && (
              <button type="button" className="hsv-cta" onClick={onHeart}>
                <span>Take a Heart reading</span>
                <span className="arrow">{'→'}</span>
              </button>
            )}
          </div>
        </div>
        <div className="hsv-back-row">
          <button type="button" className="hsv-back" onClick={onBack}>Back</button>
        </div>
      </section>
    );
  }

  // ===== List =====
  const now = new Date();
  const buckets = { today: [], yesterday: [], 'this-week': [], earlier: [] };
  for (const row of checkIns) {
    const bucket = groupForDate(row.createdAt, now);
    buckets[bucket].push(row);
  }
  const count = checkIns.length;

  return (
    <section className="hsv-stage">
      <header className="hsv-head">
        <span className="hsv-eyebrow">Your history</span>
        <p className="hsv-count">
          {count} check-in{count === 1 ? '' : 's'}
        </p>
      </header>

      {GROUP_ORDER.map((group) => {
        const rows = buckets[group];
        if (rows.length === 0) return null;
        return (
          <div className="hsv-list-section" key={group}>
            <h2 className="hsv-group-label" data-group={group}>{GROUP_LABEL[group]}</h2>
            <ol className="hsv-list">
              {rows.map((row) => {
                const kind = row.kind;
                const modalityLabel = MODALITY_LABEL[kind] || kind;
                const time = formatLocalTime(row.createdAt);
                const headlineMissing = row.headline == null || row.headline === '';
                return (
                  <li className="hsv-row" key={row.id}>
                    <time className="hsv-sr" dateTime={row.createdAt}>
                      {`${modalityLabel} check-in at ${row.createdAt}`}
                    </time>
                    <span className="hsv-row-time" aria-hidden="true">{time}</span>
                    <span
                      className="hsv-modality-chip"
                      data-kind={kind}
                      aria-label={`${modalityLabel} check-in`}
                    >
                      {modalityLabel}
                    </span>
                    <span
                      className="hsv-headline"
                      data-missing={headlineMissing ? 'true' : 'false'}
                      title={headlineMissing ? undefined : row.headline}
                    >
                      {headlineMissing ? 'Result not available' : row.headline}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      {truncated && (
        <p className="hsv-footer">
          Showing your {limit} most recent check-ins. Older check-ins are stored but not shown here.
        </p>
      )}

      <div className="hsv-back-row">
        <button type="button" className="hsv-back" onClick={onBack}>Back</button>
      </div>
    </section>
  );
}
