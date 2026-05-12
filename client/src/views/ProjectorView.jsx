import React, { useEffect, useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const css = `
  .pj {
    position: fixed; inset: 0;
    display: flex; flex-direction: column;
    color: var(--bone-0);
    font-family: var(--font-body);
    overflow: hidden;
    transition: background 1.2s ease;
  }
  .pj[data-band="early"] {
    background:
      radial-gradient(ellipse at 15% 20%, rgba(201, 169, 110, 0.12) 0%, transparent 50%),
      radial-gradient(ellipse at 85% 80%, rgba(122, 169, 184, 0.1) 0%, transparent 50%),
      linear-gradient(135deg, #15171f 0%, #1a1c26 100%);
  }
  .pj[data-band="mid"] {
    background:
      radial-gradient(ellipse at 25% 30%, rgba(231, 184, 126, 0.18) 0%, transparent 55%),
      radial-gradient(ellipse at 80% 70%, rgba(201, 169, 110, 0.14) 0%, transparent 55%),
      linear-gradient(135deg, #1a1620 0%, #252030 100%);
  }
  .pj[data-band="hot"] {
    background:
      radial-gradient(ellipse at 30% 40%, rgba(231, 184, 126, 0.35) 0%, transparent 55%),
      radial-gradient(ellipse at 75% 65%, rgba(217, 109, 91, 0.22) 0%, transparent 55%),
      linear-gradient(135deg, #2a1c1a 0%, #3a2820 100%);
  }
  .pj[data-band="victory"] {
    background:
      radial-gradient(ellipse at 50% 40%, rgba(123, 193, 150, 0.4) 0%, transparent 55%),
      radial-gradient(ellipse at 20% 80%, rgba(231, 184, 126, 0.25) 0%, transparent 55%),
      linear-gradient(135deg, #1a2e20 0%, #2a4030 100%);
    animation: pj-victory 2s ease-in-out infinite alternate;
  }
  @keyframes pj-victory {
    0%   { filter: brightness(1.0); }
    100% { filter: brightness(1.12); }
  }

  /* Grain overlay for texture */
  .pj::before {
    content: '';
    position: absolute; inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: 0.05;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }
  .pj > * { position: relative; z-index: 2; }

  /* ================= Chrome (top) ================= */
  .pj-chrome {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 1.5rem 2.5rem;
    border-bottom: 1px solid var(--hairline);
  }
  .pj-chrome-l {
    display: flex; align-items: baseline; gap: 0.8rem;
    font-family: var(--font-body);
  }
  .pj-brand-mark {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.65rem;
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--bone-0);
  }
  .pj-brand-sub {
    font-size: 0.75rem;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--brass);
    font-weight: 600;
  }
  .pj-chrome-c {
    text-align: center;
    font-family: var(--font-display);
    font-size: 0.95rem;
    color: var(--bone-2);
  }
  .pj-chrome-r {
    text-align: right;
    display: flex; flex-direction: column; gap: 0.2rem;
    font-size: 0.72rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .pj-chrome-r .live {
    display: inline-flex; align-items: center; gap: 0.4rem;
    color: var(--pulse);
  }
  .pj-chrome-r .live .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--pulse);
    box-shadow: 0 0 10px var(--pulse);
    animation: pj-pulse 1.4s ease-in-out infinite;
  }
  .pj-chrome-r .offline .dot { background: var(--bone-3); box-shadow: none; }
  @keyframes pj-pulse {
    0%,100% { opacity: 0.5; }
    50%     { opacity: 1; }
  }

  /* ================= Main ================= */
  .pj-main {
    flex: 1;
    display: grid;
    grid-template-columns: 1.45fr 1fr;
    gap: 3rem;
    padding: 2.5rem 3rem 2rem;
    min-height: 0;
  }

  /* ---- Goal column ---- */
  .pj-goal-col {
    display: flex; flex-direction: column; justify-content: center;
    gap: 1.75rem;
  }
  .pj-goal-lab {
    font-family: var(--font-body);
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .pj-goal-num {
    display: flex; align-items: baseline; gap: 1rem;
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(3rem, 8.5vw, 7rem);
    line-height: 0.9;
    letter-spacing: -0.02em;
    color: var(--bone-0);
    text-shadow: 0 4px 60px rgba(0, 0, 0, 0.4);
  }
  .pj-goal-num .total { font-variant-numeric: tabular-nums; }
  .pj-goal-num .slash {  color: var(--brass); opacity: 0.7; }
  .pj-goal-num .goal {
    font-variant-numeric: tabular-nums;
    font-size: 0.45em;
    color: var(--bone-2);
  }
  .pj-goal-num .unit {
    font-family: var(--font-body);
    font-size: 0.18em;
    font-weight: 700;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--brass);
    margin-left: 0.3rem;
    align-self: flex-end;
    margin-bottom: 1rem;
  }

  /* Progress bar with tick marks */
  .pj-bar-wrap {
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .pj-bar {
    position: relative;
    height: 2.5rem;
    background: rgba(244, 236, 225, 0.04);
    border: 1px solid var(--hairline-strong);
    border-radius: 2px;
    overflow: hidden;
  }
  .pj-bar::before {
    content: '';
    position: absolute; inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(10% - 1px),
      rgba(244, 236, 225, 0.15) calc(10% - 1px),
      rgba(244, 236, 225, 0.15) 10%
    );
    z-index: 2;
  }
  .pj-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--pulse) 0%, var(--brass-bright) 45%, var(--signal) 75%, var(--warn) 100%);
    transition: width 0.7s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 0 30px rgba(231, 184, 126, 0.45);
  }
  .pj-bar-overflow {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, var(--pulse-bright) 0%, var(--pulse) 100%);
    animation: pj-shimmer 2s linear infinite;
  }
  @keyframes pj-shimmer {
    0%, 100% { filter: brightness(1); }
    50%      { filter: brightness(1.25); }
  }
  .pj-bar-legend {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    color: var(--bone-3);
  }

  /* Stats strip */
  .pj-stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
  }
  .pj-stats[data-heart="true"] {
    grid-template-columns: repeat(4, 1fr);
  }
  .pj-stat .v.heart { color: var(--warn); }
  .pj-stat {
    display: flex; flex-direction: column; gap: 0.4rem;
  }
  .pj-stat .k {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .pj-stat .v {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(1.8rem, 3.6vw, 2.6rem);
    line-height: 0.95;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    font-variant-numeric: tabular-nums;
  }
  .pj-stat .v.flagged { color: var(--warn); }
  .pj-stat .u {
    font-size: 0.72rem; font-weight: 600;
    letter-spacing: 0.2em;
    color: var(--bone-3);
    text-transform: uppercase;
  }

  /* Teams strip */
  .pj-teams {
    display: flex; gap: 1rem; flex-wrap: wrap;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
  }
  .pj-team {
    min-width: 8rem;
    padding: 0.75rem 1rem;
    background: rgba(244, 236, 225, 0.03);
    border: 1px solid var(--hairline-strong);
    border-radius: 0.5rem;
    display: flex; flex-direction: column; gap: 0.25rem;
  }
  .pj-team.rank-1 {
    background: linear-gradient(135deg, rgba(231, 184, 126, 0.18), rgba(201, 169, 110, 0.08));
    border-color: var(--brass);
    box-shadow: 0 0 24px var(--brass-glow);
  }
  .pj-team .rk {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .pj-team.rank-1 .rk { color: var(--brass); }
  .pj-team .code {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 1.25rem;
    letter-spacing: 0.12em;
    color: var(--bone-0);
  }
  .pj-team .metric {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--bone-2);
    letter-spacing: 0.05em;
  }

  /* ---- Narrator column ---- */
  .pj-nar {
    display: flex; flex-direction: column; gap: 1.25rem;
    padding: 2rem;
    background:
      radial-gradient(ellipse at top right, rgba(231, 184, 126, 0.08), transparent 55%),
      rgba(18, 19, 26, 0.55);
    border: 1px solid var(--hairline);
    border-radius: 1.25rem;
    backdrop-filter: blur(10px);
    min-height: 0;
    position: relative;
  }
  .pj-nar::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--brass) 40%, var(--brass) 60%, transparent);
  }
  .pj-nar-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--hairline);
  }
  .pj-nar-hd .lab {
    display: flex; align-items: center; gap: 0.6rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .pj-nar-hd .lab .dot {
    width: 0.65rem; height: 0.65rem; border-radius: 50%;
    background: var(--brass);
    box-shadow: 0 0 14px var(--brass-glow);
    animation: pj-pulse 1.4s ease-in-out infinite;
  }
  .pj-nar-hd .model {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--bone-3);
    letter-spacing: 0.14em;
  }
  .pj-nar-current {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(1.25rem, 2vw, 1.8rem);
    line-height: 1.3;
    letter-spacing: 0;
    color: var(--bone-0);
    margin: 0;
    quotes: '"' '"';
  }
  .pj-nar-current::before { content: open-quote; color: var(--brass); margin-right: 0.1em; }
  .pj-nar-current::after { content: close-quote; color: var(--brass); }
  .pj-nar-cursor {
    display: inline-block;
    width: 0.5ch;
    margin-left: 0.1em;
    color: var(--brass);
    animation: pj-blink 1s steps(2) infinite;
  }
  @keyframes pj-blink {
    50% { opacity: 0; }
  }
  .pj-nar-past {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--hairline);
    display: flex; flex-direction: column; gap: 0.5rem;
    max-height: 35%;
    overflow: hidden;
  }
  .pj-nar-past .line {
    font-family: var(--font-body);
    font-size: 0.95rem;
    line-height: 1.4;
    color: var(--bone-2);
    opacity: 0.65;
  }

  /* ================= Waiting state ================= */
  .pj-waiting {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4rem;
    align-items: center;
    padding: 2rem 4rem 3rem;
  }
  .pj-waiting-copy {
    display: flex; flex-direction: column; gap: 1.5rem;
    align-items: center;
    text-align: center;
  }
  .pj-waiting-eyebrow {
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .pj-waiting-h {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(2rem, 4.2vw, 3.8rem);
    line-height: 1.08;
    letter-spacing: -0.01em;
    color: var(--bone-0);
    margin: 0;
  }
  .pj-waiting-h .brass { color: var(--brass); }
  .pj-waiting-sub {
    font-size: 1.2rem;
    line-height: 1.55;
    color: var(--bone-2);
    max-width: 36rem;
    margin: 0;
  }
  .pj-waiting-steps {
    display: flex; gap: 2rem;
    justify-content: center;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
  }
  .pj-waiting-step {
    display: flex; gap: 0.6rem;
    font-size: 0.95rem;
    color: var(--bone-1);
  }
  .pj-waiting-step .n {
    font-family: var(--font-display);
    
    font-size: 1.5rem;
    color: var(--brass);
    line-height: 1;
  }

  .pj-qr-wrap {
    display: flex; flex-direction: column; align-items: center; gap: 1rem;
  }
  .pj-qr-card {
    background: var(--bone-0);
    padding: 1.5rem;
    border-radius: 1rem;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
    position: relative;
  }
  .pj-qr-card::before {
    content: '';
    position: absolute; inset: -8px;
    border: 1px dashed var(--brass-line);
    border-radius: 1.2rem;
    opacity: 0.5;
  }
  .pj-qr-url {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    padding: 0.5rem 0.85rem;
    background: rgba(244, 236, 225, 0.06);
    border: 1px solid var(--hairline-strong);
    border-radius: 0.4rem;
    color: var(--bone-1);
    letter-spacing: 0.02em;
  }

  .pj-qr-corner {
    position: fixed;
    right: 1.25rem;
    bottom: 4rem;
    background: var(--bone-0);
    padding: 0.55rem;
    border-radius: 0.65rem;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
    display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
    z-index: 5;
  }
  .pj-qr-corner .cap {
    font-family: var(--font-body);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-0);
  }

  /* ================= Footer ================= */
  .pj-foot {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.85rem 2.5rem;
    border-top: 1px solid var(--hairline);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--bone-3);
    letter-spacing: 0.1em;
  }
  .pj-foot .meta { display: flex; gap: 1.5rem; }

  /* ================= Per-blow flash toast ================= */
  .pj-flash {
    position: fixed;
    top: 5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: baseline;
    gap: 1.2rem;
    padding: 0.85rem 1.5rem;
    background: rgba(18, 19, 26, 0.9);
    border: 1px solid var(--brass);
    border-radius: 999px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    animation: pj-flash-in 0.4s cubic-bezier(0.22, 1, 0.36, 1),
               pj-flash-out 0.5s ease-in 2.7s forwards;
    white-space: nowrap;
  }
  .pj-flash[data-kind="best"] { border-color: var(--brass-bright); box-shadow: 0 0 40px var(--brass-glow), 0 20px 60px rgba(0, 0, 0, 0.45); }
  .pj-flash[data-kind="first"] { border-color: var(--pulse); box-shadow: 0 0 40px rgba(123, 193, 150, 0.35), 0 20px 60px rgba(0, 0, 0, 0.45); }
  .pj-flash[data-kind="retry"] { border-color: var(--hairline-strong); }
  .pj-flash-lab {
    font-family: var(--font-body);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .pj-flash[data-kind="first"] .pj-flash-lab { color: var(--pulse); }
  .pj-flash[data-kind="retry"] .pj-flash-lab { color: var(--bone-3); }
  .pj-flash-num {
    font-family: var(--font-display);
    font-size: 1.7rem;
    line-height: 1;
    color: var(--bone-0);
    font-variant-numeric: tabular-nums;
  }
  .pj-flash-unit {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--bone-3);
    margin-left: 0.3rem;
  }
  .pj-flash-delta {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--brass-bright);
    letter-spacing: 0.04em;
  }
  .pj-flash-team {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--bone-3);
    letter-spacing: 0.12em;
  }
  @keyframes pj-flash-in {
    from { opacity: 0; transform: translate(-50%, -12px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes pj-flash-out {
    from { opacity: 1; transform: translate(-50%, 0); }
    to   { opacity: 0; transform: translate(-50%, -8px); }
  }

  /* ================= Reset button ================= */
  .pj-reset {
    position: fixed;
    left: 1rem;
    bottom: 3rem;
    appearance: none;
    background: rgba(18, 19, 26, 0.7);
    border: 1px solid var(--hairline-strong);
    color: var(--bone-3);
    padding: 0.4rem 0.85rem;
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    border-radius: var(--r-pill);
    cursor: pointer;
    backdrop-filter: blur(6px);
    opacity: 0.45;
    transition: all 0.2s;
    z-index: 5;
  }
  .pj-reset:hover {
    opacity: 1;
    background: rgba(217, 109, 91, 0.15);
    color: var(--warn);
    border-color: rgba(209, 133, 137, 0.35);
  }

  @media (max-width: 900px) {
    .pj-main { grid-template-columns: 1fr; gap: 1.5rem; padding: 1.5rem; }
    .pj-waiting { grid-template-columns: 1fr; gap: 2rem; padding: 1.5rem; text-align: center; }
    .pj-waiting-copy { align-items: center; }
    .pj-chrome { padding: 1rem 1.25rem; grid-template-columns: 1fr auto; }
    .pj-chrome-c { display: none; }
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

function formatLiters(x) {
  if (x == null) return '-';
  if (x >= 1000) return x.toFixed(0);
  return x.toFixed(1);
}

function bandFor(progress) {
  if (progress >= 1) return 'victory';
  if (progress >= 0.75) return 'hot';
  if (progress >= 0.35) return 'mid';
  return 'early';
}

export default function ProjectorView() {
  useCss();
  const [state, setState] = useState(null);
  const [currentLine, setCurrentLine] = useState(null);
  const [streamingLine, setStreamingLine] = useState(null);
  const [connected, setConnected] = useState(false);
  const [flashBlow, setFlashBlow] = useState(null);
  const [flashHeart, setFlashHeart] = useState(null);
  const streamIdRef = useRef(null);
  const flashTimerRef = useRef(null);
  const heartFlashTimerRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const participantUrl = typeof window !== 'undefined' ? window.location.origin + '/' : '';
  const displayUrl = participantUrl.replace(/^https?:\/\//, '');

  useEffect(() => {
    let cancelled = false;
    function connect() {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'subscribe', role: 'projector' }));
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'state' && msg.state) setState(msg.state);
          else if (msg.type === 'blow' && msg.state) {
            setState(msg.state);
            if (msg.blow) {
              setFlashBlow({ ...msg.blow, ts: Date.now() });
              if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
              flashTimerRef.current = setTimeout(() => setFlashBlow(null), 3200);
            }
          }
          else if (msg.type === 'narrator_start') {
            streamIdRef.current = msg.streamId;
            setStreamingLine('');
          }
          else if (msg.type === 'narrator_delta') {
            if (msg.streamId && msg.streamId !== streamIdRef.current) return;
            setStreamingLine((prev) => (prev ?? '') + (msg.delta || ''));
          }
          else if (msg.type === 'narrator_cancel') {
            if (msg.streamId && msg.streamId !== streamIdRef.current) return;
            setStreamingLine(null);
            streamIdRef.current = null;
          }
          else if (msg.type === 'narrator' && msg.state) {
            setState(msg.state);
            if (msg.line) setCurrentLine(msg.line);
            setStreamingLine(null);
            streamIdRef.current = null;
          }
          else if (msg.type === 'heart' && msg.state) {
            setState(msg.state);
            if (msg.heart) {
              setFlashHeart({ ...msg.heart, ts: Date.now() });
              if (heartFlashTimerRef.current) clearTimeout(heartFlashTimerRef.current);
              heartFlashTimerRef.current = setTimeout(() => setFlashHeart(null), 3200);
            }
          }
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) reconnectTimerRef.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    }
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    };
  }, []);

  const pc = state?.participantCount ?? 0;
  const total = state?.totalLiters ?? 0;
  const goal = state?.goalLiters ?? 300;
  const progress = Math.max(0, Math.min(1.5, state?.progress ?? total / Math.max(1, goal)));
  const flagged = state?.flaggedCount ?? 0;
  const meanPct = state?.meanPercentPredicted;
  const band = bandFor(progress);
  const progressPct = Math.min(100, progress * 100);
  const overflowing = progress > 1;
  const heart = state?.heart;
  const heartCount = heart?.heartCount ?? 0;

  const logFromState = Array.isArray(state?.narratorLog) ? state.narratorLog.map((e) => e.line) : [];
  const streamingActive = streamingLine !== null && streamingLine.length > 0;
  const displayLine = streamingActive
    ? streamingLine
    : currentLine || logFromState[logFromState.length - 1] || null;
  const pastLines = logFromState
    .slice(Math.max(0, logFromState.length - 5), logFromState.length)
    .filter((l) => l !== (streamingActive ? currentLine : displayLine))
    .slice(-4)
    .reverse();
  const modelLabel = (state?.model || 'gpt-5.4').toUpperCase();

  return (
    <div className="pj" data-band={band}>
      <header className="pj-chrome">
        <div className="pj-chrome-l">
          <span className="pj-brand-mark">Resona</span>
        </div>
        <div className="pj-chrome-c"></div>
        <div className="pj-chrome-r">
          <span className={connected ? 'live' : 'offline'}>
            <span className="dot" />
            {connected ? 'Live' : 'Reconnecting'}
          </span>
          <span>{modelLabel}</span>
        </div>
      </header>

      {pc === 0 ? (
        <div className="pj-waiting">
          <div className="pj-waiting-copy">
            <div className="pj-waiting-eyebrow">2 minutes · Zero hardware · Phone mic only</div>
            <h1 className="pj-waiting-h">
              Point your camera.<br /><span className="brass">Fill the bar together.</span>
            </h1>
            <div className="pj-waiting-steps">
              <div className="pj-waiting-step"><span className="n">01</span><span>Scan the code</span></div>
              <div className="pj-waiting-step"><span className="n">02</span><span>Enter team code</span></div>
              <div className="pj-waiting-step"><span className="n">03</span><span>Blow for six seconds</span></div>
            </div>
          </div>
          <div className="pj-qr-wrap">
            <div className="pj-qr-card">
              <QRCodeSVG value={participantUrl} size={280} level="M" marginSize={2} />
            </div>
            <div className="pj-qr-url">{displayUrl}</div>
          </div>
        </div>
      ) : (
        <div className="pj-main">
          <div className="pj-goal-col">
            <div className="pj-goal-lab">Team rhythm · this session</div>
            <div className="pj-goal-num">
              <span className="total">{formatLiters(total)}</span>
              <span className="slash">/</span>
              <span className="goal">{formatLiters(goal)}</span>
              <span className="unit">Litres</span>
            </div>
            <div className="pj-bar-wrap">
              <div className="pj-bar">
                <div className="pj-bar-fill" style={{ width: `${progressPct}%` }} />
                {overflowing && <div className="pj-bar-overflow" />}
              </div>
              <div className="pj-bar-legend">
                <span>{(progress * 100).toFixed(0)}% of today's goal</span>
                <span>{overflowing ? 'Goal smashed' : `${formatLiters(goal - total)} L to target`}</span>
              </div>
            </div>
            <div className="pj-stats" data-heart={heartCount > 0 ? 'true' : 'false'}>
              <div className="pj-stat">
                <span className="k">Check-ins</span>
                <span className="v">{pc}</span>
                <span className="u">people</span>
              </div>
              <div className="pj-stat">
                <span className="k">Mean</span>
                <span className="v">{meanPct != null ? Math.round(meanPct) : '-'}</span>
                <span className="u">% predicted</span>
              </div>
              <div className="pj-stat">
                <span className="k">Flagged</span>
                <span className="v flagged">{flagged}</span>
                <span className="u">for GP follow-up</span>
              </div>
              {heartCount > 0 && (
                <div className="pj-stat">
                  <span className="k">Mean HR</span>
                  <span className="v heart">
                    {heart?.meanHrBpm != null ? Math.round(heart.meanHrBpm) : '-'}
                  </span>
                  <span className="u">{heartCount} heart{heartCount === 1 ? '' : 's'} read</span>
                </div>
              )}
            </div>
            {Array.isArray(state?.topTeams) && state.topTeams.length > 0 && (
              <div className="pj-teams">
                {state.topTeams.map((t, i) => (
                  <div className={`pj-team ${i === 0 ? 'rank-1' : ''}`} key={t.teamCode}>
                    <span className="rk">#{i + 1} team</span>
                    <span className="code">{t.teamCode}</span>
                    <span className="metric">
                      {t.meanPct != null ? `${Math.round(t.meanPct)}% mean` : '— mean'} · {t.count} in
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="pj-nar">
            <div className="pj-nar-hd">
              <span className="lab"><span className="dot" />Narrator</span>
              <span className="model">{modelLabel}</span>
            </div>
            <p className="pj-nar-current">
              {displayLine || (pc > 0 ? 'Warming up the narrator' : 'Waiting for the first breath')}
              {streamingActive && <span className="pj-nar-cursor">▍</span>}
            </p>
            {pastLines.length > 0 && (
              <div className="pj-nar-past">
                {pastLines.map((l, i) => (
                  <div className="line" key={`${l}-${i}`}>{l}</div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      <footer className="pj-foot">
        <span>This is a screening tool · not a medical diagnosis</span>
        <div className="meta">
          <span>Live pitch · Watcha 2026</span>
          <span>Powered by {modelLabel}</span>
        </div>
      </footer>

      {pc > 0 && participantUrl && (
        <div className="pj-qr-corner">
          <span className="cap">Join</span>
          <QRCodeSVG value={participantUrl} size={96} level="M" marginSize={1} />
        </div>
      )}

      {flashBlow && (
        <div
          className="pj-flash"
          data-kind={flashBlow.isFirstBlow ? 'first' : flashBlow.improvedBest ? 'best' : 'retry'}
          key={flashBlow.ts}
        >
          <span className="pj-flash-lab">
            {flashBlow.isFirstBlow
              ? 'New breath on the board'
              : flashBlow.improvedBest
              ? 'Personal best improved'
              : 'Retry logged, keeping previous best'}
          </span>
          <span className="pj-flash-num">
            {flashBlow.pct}
            <span className="pj-flash-unit">% predicted</span>
          </span>
          {flashBlow.improvedBest && flashBlow.fvcDelta > 0 && (
            <span className="pj-flash-delta">+{flashBlow.fvcDelta.toFixed(2)} L</span>
          )}
          {flashBlow.teamCode && (
            <span className="pj-flash-team">team {flashBlow.teamCode}</span>
          )}
        </div>
      )}

      {flashHeart && (
        <div
          className="pj-flash"
          data-kind={flashHeart.hrClass === 'tachycardia' ? 'retry' : 'first'}
          key={`heart-${flashHeart.ts}`}
          style={{ top: '8.5rem' }}
        >
          <span className="pj-flash-lab">
            {flashHeart.isFirstCapture ? 'New heart on the board' : 'Heart re-read'}
          </span>
          <span className="pj-flash-num">
            {flashHeart.hrBpm ?? '—'}
            <span className="pj-flash-unit">bpm</span>
          </span>
          {flashHeart.hrvRmssdMs != null && (
            <span className="pj-flash-delta">HRV {Math.round(flashHeart.hrvRmssdMs)} ms</span>
          )}
          {flashHeart.teamCode && (
            <span className="pj-flash-team">team {flashHeart.teamCode}</span>
          )}
        </div>
      )}

      <button
        className="pj-reset"
        onClick={async () => {
          if (!confirm('Reset the room? All participant counts and narrator lines will be cleared.')) return;
          try {
            await fetch('/api/admin/reset', { method: 'POST' });
          } catch (err) {
            alert(`Reset failed: ${err.message}`);
          }
        }}
      >
        Reset room
      </button>
    </div>
  );
}
