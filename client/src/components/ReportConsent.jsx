import React from 'react';

export default function ReportConsent({ available, consent, onChange }) {
  return (
    <div style={{ maxWidth: 540, margin: '1rem auto', color: 'var(--bone-1)', fontSize: '0.85rem', lineHeight: 1.5 }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
        <input type="checkbox" checked={available && consent} disabled={!available} onChange={(event) => onChange(event.target.checked)} />
        <span>Send my numerical readings for automatic Codex reports</span>
      </label>
      <p>{available ? 'Numerical readings go to our server and OpenAI and can be personal information. Successful reports and readings are saved with your account. OpenAI may retain safety monitoring logs. Raw audio, video and motion stay on your phone. Leave this unchecked for local-only readings.' : 'Codex reports are unavailable. Your readings stay on your phone.'}</p>
    </div>
  );
}
