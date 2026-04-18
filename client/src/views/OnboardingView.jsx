import React, { useState } from 'react';
import { ETHNICITY_OPTIONS } from '../../../shared/reference-equations.js';

const css = `
  .ob-card {
    width: 100%;
    max-width: 28rem;
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    text-align: left;
    margin-top: var(--s-2);
    padding: var(--s-5);
    background: linear-gradient(180deg, rgba(26, 28, 38, 0.6), rgba(18, 19, 26, 0.4));
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    position: relative;
    overflow: hidden;
  }
  .ob-card::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--brass) 50%, transparent);
    opacity: 0.4;
  }

  .ob-heading {
    display: flex; flex-direction: column; gap: var(--s-1);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--hairline);
  }
  .ob-eyebrow {
    font-family: var(--font-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--brass);
  }
  .ob-title {
    font-family: var(--font-display);
    
    font-weight: 400;
    font-size: 1.85rem;
    line-height: 1;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--bone-0);
  }
  .ob-lead {
    margin: var(--s-1) 0 0;
    font-size: var(--t-small);
    color: var(--bone-2);
    line-height: 1.55;
  }
  .ob-lead .tag {
    color: var(--brass);
    font-weight: 600;
  }

  .ob-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3);
  }
  .ob-grid .ob-field-full { grid-column: 1 / -1; }

  .ob-field {
    display: flex; flex-direction: column; gap: var(--s-2);
  }
  .ob-label {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--s-2);
    font-family: var(--font-body);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--bone-3);
  }
  .ob-label .opt {
    color: var(--brass-dim);
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    font-weight: 500;
  }
  .ob-input, .ob-select {
    appearance: none;
    background: var(--ink-0);
    border: 1px solid var(--hairline);
    color: var(--bone-0);
    border-radius: var(--r-sm);
    padding: 0.9rem var(--s-3);
    font-family: var(--font-body);
    font-size: 0.98rem;
    font-weight: 500;
    width: 100%;
    transition: border-color 0.15s, background 0.15s;
  }
  .ob-input::placeholder { color: var(--bone-3); opacity: 0.7; }
  .ob-input:focus, .ob-select:focus {
    outline: none;
    border-color: var(--brass);
    background: var(--ink-2);
    box-shadow: 0 0 0 3px rgba(201, 169, 110, 0.08);
  }
  .ob-input.mono { font-family: var(--font-mono); letter-spacing: 0.08em; }
  .ob-select {
    background-image:
      linear-gradient(45deg, transparent 50%, var(--brass) 50%),
      linear-gradient(135deg, var(--brass) 50%, transparent 50%);
    background-position:
      calc(100% - 1.1rem) 50%,
      calc(100% - 0.75rem) 50%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
    padding-right: 2rem;
  }

  .ob-sex {
    display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2);
  }
  .ob-sex button {
    appearance: none;
    background: var(--ink-0);
    border: 1px solid var(--hairline);
    color: var(--bone-2);
    padding: 0.9rem var(--s-2);
    font-family: var(--font-body);
    font-size: 0.88rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all 0.12s;
  }
  .ob-sex button[aria-pressed="true"] {
    background: rgba(201, 169, 110, 0.08);
    border-color: var(--brass);
    color: var(--bone-0);
    box-shadow: inset 0 0 0 1px var(--brass);
  }
  .ob-sex button:focus-visible {
    outline: none;
    border-color: var(--brass);
    box-shadow: 0 0 0 3px rgba(201, 169, 110, 0.22);
  }

  .ob-consent {
    display: flex; align-items: flex-start; gap: var(--s-3);
    font-size: 0.8rem;
    line-height: 1.55;
    color: var(--bone-2);
    padding: var(--s-3);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--ink-0);
    cursor: pointer;
  }
  .ob-consent input {
    margin-top: 0.15rem;
    width: 1.1rem; height: 1.1rem;
    accent-color: var(--brass);
    flex-shrink: 0;
  }
  .ob-consent strong { color: var(--bone-0); font-weight: 600; }

  .ob-submit {
    appearance: none;
    border: none;
    background: var(--bone-0);
    color: var(--ink-0);
    font-family: var(--font-body);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    padding: 1.1rem 1.5rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: transform 0.12s, box-shadow 0.15s;
    display: flex; align-items: center; justify-content: center;
    gap: var(--s-2);
  }
  .ob-submit:hover { box-shadow: var(--shadow-brass); }
  .ob-submit:active { transform: scale(0.99); }
  .ob-submit .arrow {
    font-family: var(--font-display);
    
    font-size: 1.2rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--brass-dim);
  }

  .ob-err {
    padding: var(--s-3) var(--s-4);
    background: var(--warn-dim);
    border: 1px solid rgba(209, 133, 137, 0.3);
    color: #f3c7c8;
    border-radius: var(--r-sm);
    font-size: var(--t-small);
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

function validate({ ageYears, sex, heightCm, ethnicity, consent }) {
  if (!sex) return 'Please pick male or female for sex at birth.';
  if (!Number.isFinite(ageYears) || ageYears < 20 || ageYears > 80) return 'Age must be between 20 and 80.';
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 230) return 'Height must be between 100 and 230 cm.';
  if (!ethnicity) return 'Please pick an ethnicity, it affects the reference values.';
  if (!consent) return 'Please tick the consent box so we know you understand this is a screening tool.';
  return null;
}

export default function OnboardingView({ onSubmit }) {
  useCss();
  const [name, setName] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [sex, setSex] = useState('');
  const [ethnicity, setEthnicity] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    const ageYears = Number(age);
    const heightCm = Number(height);
    const problem = validate({ ageYears, sex, heightCm, ethnicity, consent });
    if (problem) {
      setErr(problem);
      return;
    }
    setErr(null);
    const cleanTeam = teamCode.trim().toUpperCase().slice(0, 6) || null;
    onSubmit({
      name: name.trim() || null,
      teamCode: cleanTeam,
      ageYears,
      heightCm,
      sex,
      ethnicity,
      consent: true,
    });
  }

  return (
    <form className="ob-card" onSubmit={handleSubmit}>
      <div className="ob-heading">
        <span className="ob-eyebrow">Before we listen</span>
        <h2 className="ob-title">Tell us about you.</h2>
        <p className="ob-lead">
          We use age, sex, height and ethnicity to calibrate expected lung values against the Hankinson
          NHANES III reference. <span className="tag">No audio leaves your phone.</span>
        </p>
      </div>

      <div className="ob-grid">
        <div className="ob-field ob-field-full">
          <label className="ob-label" htmlFor="ob-name">
            <span>Name</span><span className="opt">Optional</span>
          </label>
          <input
            id="ob-name"
            className="ob-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="First name or leave blank"
            autoComplete="given-name"
            maxLength={40}
          />
        </div>

        <div className="ob-field ob-field-full">
          <label className="ob-label" htmlFor="ob-team">
            <span>Team code</span><span className="opt">Optional · for leaderboard</span>
          </label>
          <input
            id="ob-team"
            className="ob-input mono"
            type="text"
            value={teamCode}
            onChange={(e) => setTeamCode(e.target.value)}
            placeholder="ENG · MKTG · SALES"
            maxLength={6}
            style={{ textTransform: 'uppercase' }}
          />
        </div>

        <div className="ob-field">
          <label className="ob-label" htmlFor="ob-age"><span>Age</span></label>
          <input
            id="ob-age"
            className="ob-input mono"
            type="number"
            inputMode="numeric"
            min="20"
            max="80"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="e.g. 32"
            required
          />
        </div>

        <div className="ob-field">
          <label className="ob-label" htmlFor="ob-height"><span>Height cm</span></label>
          <input
            id="ob-height"
            className="ob-input mono"
            type="number"
            inputMode="numeric"
            min="100"
            max="230"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder="e.g. 175"
            required
          />
        </div>

        <div className="ob-field ob-field-full">
          <label className="ob-label" id="ob-sex-label"><span>Sex at birth</span></label>
          <div className="ob-sex" role="group" aria-labelledby="ob-sex-label">
            <button type="button" aria-pressed={sex === 'male'} onClick={() => setSex('male')}>Male</button>
            <button type="button" aria-pressed={sex === 'female'} onClick={() => setSex('female')}>Female</button>
          </div>
        </div>

        <div className="ob-field ob-field-full">
          <label className="ob-label" htmlFor="ob-ethnicity"><span>Ethnicity</span></label>
          <select
            id="ob-ethnicity"
            className="ob-select"
            value={ethnicity}
            onChange={(e) => setEthnicity(e.target.value)}
            required
          >
            <option value="">Select one...</option>
            {ETHNICITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="ob-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          I understand this is a <strong>screening tool, not a medical diagnosis</strong>. Results are
          indicative only. No audio is uploaded to any server.
        </span>
      </label>

      {err && <div className="ob-err">{err}</div>}

      <button className="ob-submit" type="submit">
        <span>Ready to blow</span>
        <span className="arrow">→</span>
      </button>
    </form>
  );
}
