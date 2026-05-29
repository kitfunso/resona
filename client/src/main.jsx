import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.js';

// -----------------------------------------------------------------------------
// Resona, design system tokens + base typography.
// Editorial medical-instrument aesthetic: cream/ink/brass, display serif for
// brand moments, refined sans for body, monospace for numeric readings.
// -----------------------------------------------------------------------------
const styles = `
  :root {
    color-scheme: dark;

    /* Ink scale, warm graphite rather than pure black */
    --ink-0: #0a0b10;
    --ink-1: #12131a;
    --ink-2: #1a1c26;
    --ink-3: #242732;
    --ink-4: #303545;

    /* Bone / cream, for text */
    --bone-0: #f4ece1;
    --bone-1: #e4d9c4;
    --bone-2: #b8ac94;
    --bone-3: #8a8272;

    /* Metallic accents */
    --brass: #c9a96e;
    --brass-bright: #e6c68a;
    --brass-dim: #7a6542;
    --brass-line: rgba(201, 169, 110, 0.2);
    --brass-glow: rgba(201, 169, 110, 0.25);

    /* Signal / state */
    --signal: #e7b87e;
    --signal-bright: #f5cf94;
    --pulse: #7bc196;
    --pulse-bright: #9ad8b3;
    --pulse-dim: rgba(123, 193, 150, 0.15);
    --warn: #d18589;
    --warn-dim: rgba(209, 133, 137, 0.15);
    --cool: #7aa9b8;
    --cool-dim: rgba(122, 169, 184, 0.15);

    /* Dividers */
    --hairline: rgba(244, 236, 225, 0.08);
    --hairline-strong: rgba(244, 236, 225, 0.18);

    /* Typography */
    --font-display: 'Young Serif', Georgia, serif;
    --font-body: 'Manrope', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;

    /* Spacing scale (4px base) */
    --s-0: 0.125rem;
    --s-1: 0.25rem;
    --s-2: 0.5rem;
    --s-3: 0.75rem;
    --s-4: 1rem;
    --s-5: 1.5rem;
    --s-6: 2rem;
    --s-7: 3rem;
    --s-8: 4rem;
    --s-9: 6rem;

    /* Radii */
    --r-xs: 0.3rem;
    --r-sm: 0.5rem;
    --r-md: 0.85rem;
    --r-lg: 1.25rem;
    --r-xl: 1.75rem;
    --r-pill: 999px;

    /* Type scale */
    --t-micro: 0.7rem;
    --t-caption: 0.78rem;
    --t-small: 0.88rem;
    --t-body: 1rem;
    --t-lead: 1.1rem;
    --t-h3: 1.35rem;
    --t-h2: 1.8rem;
    --t-h1: 2.5rem;
    --t-display: clamp(3rem, 10vw, 6rem);

    /* Shadows */
    --shadow-1: 0 2px 12px rgba(0, 0, 0, 0.4);
    --shadow-2: 0 12px 48px rgba(0, 0, 0, 0.55);
    --shadow-brass: 0 0 36px rgba(201, 169, 110, 0.25);
  }

  * { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }

  body {
    background:
      radial-gradient(ellipse at top, #1f2230 0%, transparent 55%),
      radial-gradient(ellipse at bottom right, #23191c 0%, transparent 60%),
      var(--ink-1);
    background-attachment: fixed;
    color: var(--bone-0);
    font-family: var(--font-body);
    font-weight: 400;
    line-height: 1.45;
    letter-spacing: 0.003em;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: none;
  }

  /* Grain overlay for warm depth */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: 0.04;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.8'/></svg>");
  }

  #root { position: relative; z-index: 2; }

  /* Utility: numeric readings */
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }

  /* Utility: small caps label */
  .label {
    font-family: var(--font-body);
    font-size: var(--t-caption);
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--bone-3);
  }

  /* Utility: serif display */
  .serif {
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: -0.01em;
  }

  /* Decorative tick row, used as section separator or calibration marker */
  .ticks {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 8px;
    opacity: 0.5;
  }
  .ticks span {
    display: block;
    width: 1px;
    background: var(--brass);
  }
  .ticks span:nth-child(5n + 1) { height: 8px; }
  .ticks span:nth-child(n) { height: 4px; }

  /* Button reset */
  button {
    font-family: inherit;
    color: inherit;
  }

  input, select, textarea {
    font-family: inherit;
  }
`;

const styleTag = document.createElement('style');
styleTag.textContent = styles;
document.head.appendChild(styleTag);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
