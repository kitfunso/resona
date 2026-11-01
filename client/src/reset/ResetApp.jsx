import React, { useEffect, useRef, useState } from 'react';
import { ENERGY, INTENTIONS, REFLECTIONS, MINUTE_MS, createClock, remainingAt,
  resumeClock, pauseClock, breathPhase, buildCard, cardText } from './reset.js';
import { createVoiceGuide, voiceAssetsAvailable } from './voice.js';
import './voice.css';

const STAGES = Object.freeze(['Check in', 'Take a minute', 'Notice', 'Your next step']);

function Choices({ legend, name, choices, value, onChange }) {
  return <fieldset className="reset-choices"><legend>{legend}</legend>
    <div>{Object.entries(choices).map(([key, label]) => <label key={key} className={value === key ? 'is-selected' : ''}>
      <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} />
      <span>{label}</span><span className="reset-radio" aria-hidden="true" />
    </label>)}</div>
  </fieldset>;
}

function Dial({ remaining, running }) {
  const phase = breathPhase(remaining);
  return <div className="reset-dial" style={{ '--reset-elapsed': `${-(MINUTE_MS - remaining) / 1000}s` }}>
    <div className="reset-dial-rings" aria-hidden="true"><i /><i /><i /></div>
    <div className="reset-dial-core">
      <span className="reset-overline">A MOMENT TO YOURSELF</span>
      <strong aria-live="polite" aria-atomic="true">{running ? phase : 'At your pace'}</strong>
      <span className="reset-countdown" aria-hidden="true">{String(Math.ceil(remaining / 1000)).padStart(2, '0')}<small> SEC</small></span>
    </div>
  </div>;
}

export default function ResetApp() {
  const [stage, setStage] = useState(0);
  const [energy, setEnergy] = useState('');
  const [intention, setIntention] = useState('');
  const [reflection, setReflection] = useState('');
  const [clock, setClock] = useState(createClock);
  const [now, setNow] = useState(0);
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceAvailable, setVoiceAvailable] = useState(null);
  const heading = useRef(null);
  const voice = useRef(null);
  const remaining = remainingAt(clock, now);
  const running = clock.startedAt !== null;

  useEffect(() => { if (stage > 0) heading.current?.focus(); }, [stage]);

  useEffect(() => {
    voice.current = createVoiceGuide({ onError: () => {
      setVoiceEnabled(false);
      setVoiceError('Voice is unavailable. You can still follow the circle.');
    } });
    return () => { voice.current?.stop(); voice.current = null; };
  }, []);

  useEffect(() => {
    voice.current?.update({ enabled: voiceEnabled, active: stage === 1 && running, remaining });
  }, [voiceEnabled, stage, running, remaining]);

  useEffect(() => {
    if (stage !== 1) return undefined;
    const controller = new AbortController();
    voiceAssetsAvailable(fetch, controller.signal).then((available) => {
      if (!controller.signal.aborted) setVoiceAvailable(available);
    });
    return () => controller.abort();
  }, [stage]);

  useEffect(() => {
    if (stage !== 1 || !running) return undefined;
    const interval = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(interval);
  }, [stage, running]);

  useEffect(() => {
    if (stage === 1 && remaining === 0) {
      setCompleted(true);
      setClock({ remainingMs: 0, startedAt: null });
      setStage(2);
    }
  }, [stage, remaining]);

  useEffect(() => {
    if (stage !== 1) return undefined;
    const pauseWhenHidden = () => {
      if (!document.hidden) return;
      voice.current?.stop();
      const time = performance.now();
      setNow(time);
      setClock((current) => pauseClock(current, time));
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [stage]);

  function toggleClock() {
    const time = performance.now();
    if (running) voice.current?.stop();
    else voice.current?.update({ enabled: voiceEnabled, active: true, remaining: remainingAt(clock, time) });
    setNow(time);
    setClock(running ? pauseClock(clock, time) : resumeClock(clock, time));
    setStarted(true);
  }

  function finishEarly() {
    voice.current?.stop();
    const time = performance.now();
    setCompleted(remainingAt(clock, time) === 0);
    setClock(pauseClock(clock, time));
    setStage(2);
  }

  function restart() {
    voice.current?.reset();
    setEnergy(''); setIntention(''); setReflection(''); setStage(0);
    setClock(createClock()); setNow(0); setStarted(false); setCompleted(false);
    setSaveError(''); setSaved(false);
    setVoiceEnabled(false); setVoiceError('');
    window.setTimeout(() => heading.current?.focus(), 0);
  }

  function saveCard(card) {
    setSaveError('');
    try {
      const url = URL.createObjectURL(new Blob([cardText(card)], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'resona-reset.txt';
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaved(true);
    } catch (error) {
      console.error('Could not prepare the reset download.', error);
      setSaveError('Could not start the download. Select and copy your card below.');
    }
  }

  const card = stage === 3 ? buildCard({ energy, intention, reflection, completed }) : null;

  return <div className="reset-page">
    <a className="reset-skip" href="#reset-main">Skip to check-in</a>
    <header className="reset-header"><a className="reset-brand" href="/reset.html" aria-label="Resona Reset home">resona<span>reset</span></a>
      <span className="reset-private"><span aria-hidden="true">◌</span> Just for you</span></header>
    <main id="reset-main" className="reset-main">
      <nav aria-label="Your reset progress" className="reset-progress"><ol>{STAGES.map((label, index) =>
        <li key={label} aria-current={index === stage ? 'step' : undefined} className={index <= stage ? 'is-current' : ''}>
          <span aria-hidden="true">0{index + 1}</span><span>{label}</span></li>)}</ol></nav>
      {stage === 0 && <div className="reset-intro reset-enter">
        <div className="reset-story"><p className="reset-overline">EVERY BODY HAS A RHYTHM</p>
          <h1 ref={heading} tabIndex={-1}>A little space.<br /><em>Then your next step.</em></h1>
          <p className="reset-lead">Check in with yourself. Take a guided minute. Leave with one small thing you can do next.</p>
          <div className="reset-note"><span className="reset-note-mark" aria-hidden="true">↗</span><p>Your pace. Your choice.<br /><span>No account, camera or microphone needed.</span></p></div>
        </div>
        <form className="reset-panel" onSubmit={(event) => { event.preventDefault(); if (energy && intention) setStage(1); }}>
          <p className="reset-overline">START WHERE YOU ARE</p>
          <Choices legend="How are you arriving?" name="energy" choices={ENERGY} value={energy} onChange={setEnergy} />
          <Choices legend="What would help right now?" name="intention" choices={INTENTIONS} value={intention} onChange={setIntention} />
          <button className="reset-primary" disabled={!energy || !intention} type="submit">Make a little space <span aria-hidden="true">→</span></button>
          <p className="reset-micro">Your choices stay in this tab. Reload to clear them.</p>
        </form>
      </div>}
      {stage === 1 && <section className="reset-session reset-enter" aria-labelledby="reset-title">
        <p className="reset-overline">LET THE REST WAIT A MOMENT</p>
        <h1 id="reset-title" ref={heading} tabIndex={-1}>Nothing to get right.</h1>
        <p className="reset-lead">Let the circle offer a pace. Keep your breathing comfortable.<br />You can ignore the guide or stop whenever you like.</p>
        <Dial remaining={remaining} running={running} />
        <p className="reset-micro reset-timer-note">{started && !running ? 'Paused. Your remaining time is saved.' : 'The timer pauses when you leave this tab.'}</p>
        <label className="reset-voice-option"><input type="checkbox" disabled={!voiceAvailable} checked={voiceEnabled} onChange={(event) => {
          const enabled = event.target.checked;
          setVoiceEnabled(enabled); setVoiceError('');
          if (!enabled) voice.current?.stop();
          else {
            voice.current?.prepare();
            if (running) voice.current?.update({ enabled, active: true, remaining: remainingAt(clock, performance.now()) });
          }
        }} /> Optional AI-generated breathing voice</label>
        {voiceAvailable === false && <p className="reset-micro reset-voice-status" role="status">Voice is not available yet. Follow the circle at your own pace.</p>}
        {voiceError && <p className="reset-micro reset-voice-status" role="status">{voiceError}</p>}
        <button className="reset-primary" onClick={toggleClock}>{running ? 'Pause' : started ? 'Resume your minute' : 'Begin your minute'}<span aria-hidden="true">{running ? 'Ⅱ' : '→'}</span></button>
        <button className="reset-text-button" onClick={finishEarly}>Finish the guide early</button>
      </section>}
      {stage === 2 && <section className="reset-reflect reset-panel reset-enter" aria-labelledby="reflect-title">
        <p className="reset-overline">{completed ? 'A MINUTE, JUST FOR YOU' : 'YOU CHOSE YOUR OWN PACE'}</p>
        <h1 id="reflect-title" ref={heading} tabIndex={-1}>What do you notice?</h1>
        <p className="reset-lead">There is no right answer.<br />A pause does not have to change how you feel.</p>
        <Choices legend="Compared with when you arrived" name="reflection" choices={REFLECTIONS} value={reflection} onChange={setReflection} />
        <button className="reset-primary" disabled={!reflection} onClick={() => setStage(3)}>Find my next step <span aria-hidden="true">→</span></button>
      </section>}
      {stage === 3 && <section className="reset-result reset-enter" aria-labelledby="result-title">
        <div className="reset-result-intro"><p className="reset-overline">TAKE ONE SMALL THING WITH YOU</p>
          <h1 id="result-title" ref={heading} tabIndex={-1}>{card.title}</h1><p className="reset-lead">{card.action}</p>
          <p className="reset-observation">{card.message}</p>
          <button className="reset-primary" onClick={() => saveCard(card)}>Save my next step <span aria-hidden="true">↓</span></button>
          <p className="reset-save-status" role="status">{saved ? 'Download started. Keep this card for yourself.' : ''}</p>
          <button className="reset-text-button" onClick={restart}>Start a fresh check-in</button>
        </div>
        <aside className="reset-panel reset-summary" aria-label="Your check-in summary"><p className="reset-overline">YOUR MOMENT, IN YOUR WORDS</p>
          <figure className="reset-art"><img src="/reset-art.webp" alt="A golden sun over layered paper hills, with a winding path" width="1280" height="720" />
            <figcaption>AI-created artwork, prepared for Resona.</figcaption></figure>
          <dl><div><dt>Arriving</dt><dd>{card.before}</dd></div><div><dt>Looking for</dt><dd>{card.intention}</dd></div><div><dt>Leaving</dt><dd>{card.after}</dd></div></dl>
          <p className="reset-session-status"><span aria-hidden="true">◷</span> {card.session}</p>
          <p className="reset-micro">A suggestion picked from your choices, using local rules. No AI or medical assessment.</p>
          {saveError && <><p role="alert">{saveError}</p><textarea aria-label="Your text card" readOnly value={cardText(card)} rows={12} /></>}
        </aside>
      </section>}
    </main>
    <footer className="reset-footer"><p>A wellbeing pause, not a medical assessment.</p><p>Private by design <span aria-hidden="true">·</span> Built on Resona</p></footer>
  </div>;
}
