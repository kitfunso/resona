import React, { useState } from 'react';
import { requestSignInCode, verifySignInCode } from '../auth.js';

export default function LoginView({ onSignedIn }) {
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
      <h1>Sign in to Resona</h1>
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
          <p>We sent a 6-digit code to <strong>{email}</strong>.</p>
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
  );
}
