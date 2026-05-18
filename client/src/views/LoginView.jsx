import React, { useState } from 'react';
import { requestSignInCode, verifySignInCode } from '../auth.js';

const css = `
  .login-view {
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-7) var(--s-4);
  }

  .lv-card {
    width: 100%;
    max-width: 23rem;
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    padding: var(--s-6) var(--s-5);
    background: linear-gradient(180deg, rgba(26, 28, 38, 0.6), rgba(18, 19, 26, 0.4));
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    position: relative;
    overflow: hidden;
  }
  .lv-card::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--brass) 50%, transparent);
    opacity: 0.4;
  }

  .lv-head {
    display: flex; flex-direction: column; gap: var(--s-1);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .lv-eyebrow {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .lv-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 1.85rem;
    line-height: 1;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--bone-0);
  }

  .login-view form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .login-view label {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--bone-3);
  }

  .login-view input {
    appearance: none;
    background: var(--ink-0);
    border: 1px solid var(--hairline);
    color: var(--bone-0);
    border-radius: var(--r-sm);
    padding: 0.9rem var(--s-3);
    font-size: 0.98rem;
    font-weight: 500;
    letter-spacing: normal;
    text-transform: none;
    width: 100%;
    transition: border-color 0.15s;
  }
  .login-view input:focus {
    outline: none;
    border-color: var(--brass);
  }

  .login-view button {
    appearance: none;
    cursor: pointer;
    border-radius: var(--r-sm);
    padding: 0.85rem var(--s-4);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    transition: opacity 0.15s, background 0.15s;
  }
  .login-view button[type='submit'] {
    background: var(--brass);
    border: 1px solid var(--brass);
    color: var(--ink-0);
  }
  .login-view button[type='button'] {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--bone-3);
  }
  .login-view button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .login-view .lv-sent {
    margin: 0;
    font-size: var(--t-small);
    color: var(--bone-2);
    line-height: 1.55;
  }
  .login-view .lv-sent strong { color: var(--bone-0); }

  .login-view .error {
    margin: 0;
    font-size: var(--t-caption);
    color: var(--warn);
    letter-spacing: 0.01em;
  }

  .app-loading {
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bone-3);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
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

export default function LoginView({ onSignedIn }) {
  useCss();
  const [stage, setStage] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitEmail(e) {
    e.preventDefault();
    if (!email.includes('@')) return setError('Please enter a valid email.');
    setBusy(true); setError('');
    try {
      await requestSignInCode(email);
      setStage('code');
    } catch (err) {
      setError('Could not send code. Try again in a moment.');
    } finally { setBusy(false); }
  }

  async function submitCode(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
    setBusy(true); setError('');
    try {
      await verifySignInCode(email, code);
      onSignedIn();
    } catch (err) {
      setError('Code invalid or expired. Request a new one.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login-view">
      <div className="lv-card">
        <div className="lv-head">
          <span className="lv-eyebrow">Resona</span>
          <h1 className="lv-title">Sign in</h1>
        </div>
        {stage === 'email' && (
          <form onSubmit={submitEmail}>
            <label>
              Your work email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Sending...' : 'Send me a code'}
            </button>
          </form>
        )}
        {stage === 'code' && (
          <form onSubmit={submitCode}>
            <p className="lv-sent">We sent a 6-digit code to <strong>{email}</strong>.</p>
            <label>
              Code
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Verifying...' : 'Sign in'}
            </button>
            <button type="button" onClick={() => setStage('email')} disabled={busy}>
              Use a different email
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
