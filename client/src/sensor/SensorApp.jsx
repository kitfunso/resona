import React, { useEffect, useRef, useState } from 'react';
import { unlockAudio, acquireMicPermission, recordBlow } from '../audio/recorder.js';
import { requestMotionPermission, captureMotion } from '../imu/motion.js';
import { analysisPayload, breathReading, walkReading } from './readings.js';

const STAGES = ['Breath', 'Walk', 'Your readings'];
const demoToken = new URLSearchParams(window.location.hash.slice(1)).get('token');
if (demoToken) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);

function errorMessage(error, fallback) {
  if (error?.name === 'AbortError') return 'Recording stopped. Return to this tab and try again.';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Permission was denied. Allow access in your browser settings and try again.';
  }
  if (error?.name === 'NotFoundError') return 'This device does not have the required sensor.';
  return fallback;
}

export default function SensorApp() {
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [breath, setBreath] = useState(null);
  const [walk, setWalk] = useState(null);
  const [analysis, setAnalysis] = useState('');
  const controller = useRef(null);
  const captureController = useRef(null);
  const heading = useRef(null);

  useEffect(() => { if (stage > 0) heading.current?.focus(); }, [stage]);

  useEffect(() => {
    const stopIfHidden = () => { if (document.hidden) captureController.current?.abort(); };
    const stopOnExit = () => captureController.current?.abort();
    document.addEventListener('visibilitychange', stopIfHidden);
    window.addEventListener('pagehide', stopOnExit);
    return () => {
      document.removeEventListener('visibilitychange', stopIfHidden);
      window.removeEventListener('pagehide', stopOnExit);
      captureController.current?.abort();
      controller.current?.abort();
    };
  }, []);

  async function captureBreath() {
    setError(''); setBusy(true); setProgress(0);
    const capture = new AbortController();
    captureController.current = capture;
    try {
      unlockAudio();
      await acquireMicPermission({ signal: capture.signal });
      const { pcm, sampleRate } = await recordBlow({ signal: capture.signal, onTick: ({ pct }) => setProgress(pct) });
      setBreath(breathReading(pcm, sampleRate));
      setStage(1);
    } catch (err) {
      setError(errorMessage(err, 'Could not record the breath sound. Check microphone access and try again.'));
    } finally { captureController.current = null; setBusy(false); setProgress(0); }
  }

  async function captureWalk() {
    setError(''); setBusy(true); setProgress(0);
    const captureAbort = new AbortController();
    captureController.current = captureAbort;
    try {
      if (await requestMotionPermission() !== 'granted') throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
      const capture = await captureMotion({ signal: captureAbort.signal, onTick: ({ pct }) => setProgress(pct) });
      setWalk(walkReading(capture));
      setStage(2);
    } catch (err) {
      setError(errorMessage(err, 'Could not read motion. Check motion access or try a phone with motion sensors.'));
    } finally { captureController.current = null; setBusy(false); setProgress(0); }
  }

  async function requestAnalysis() {
    setError(''); setAnalysis(''); setBusy(true);
    if (!demoToken) {
      setError('AI analysis needs the private demo link. Your readings are still shown below.');
      setBusy(false);
      return;
    }
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await fetch('/api/sensor-analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${demoToken}` },
        body: JSON.stringify(analysisPayload(breath, walk)), signal: request.signal,
      });
      const result = await response.json();
      if (!response.ok || typeof result.analysis !== 'string' || !result.analysis.trim()) throw new Error('Analysis unavailable');
      setAnalysis(result.analysis);
    } catch (err) {
      if (err.name !== 'AbortError') setError('AI analysis is unavailable. Your readings are still shown below.');
    } finally { controller.current = null; setBusy(false); }
  }

  function restart() {
    controller.current?.abort(); setBreath(null); setWalk(null); setAnalysis(''); setError(''); setStage(0);
  }

  return <div className="sensor-page">
    <header className="sensor-header"><a href="/sensor.html" className="sensor-brand">resona<span>check-in</span></a><span>YOUR PHONE, YOUR PACE</span></header>
    <main className="sensor-main">
      <nav aria-label="Check-in progress"><ol className="sensor-progress">{STAGES.map((name, index) =>
        <li key={name} aria-current={index === stage ? 'step' : undefined} className={index <= stage ? 'active' : ''}><span>0{index + 1}</span> {name}</li>)}</ol></nav>
      {stage === 0 && <section aria-labelledby="breath-title" className="sensor-card">
        <p className="sensor-kicker">01 / BREATH</p><h1 id="breath-title" ref={heading} tabIndex={-1}>Take a breath.</h1>
        <p>Hold your phone near you and breathe out towards the microphone for a few seconds. Keep it comfortable and stop if you feel unwell.</p>
        <p className="sensor-note">We process the sound on your phone. The recording is not uploaded or saved.</p>
        <button disabled={busy} onClick={captureBreath}>{busy ? 'Recording…' : 'Record breath sound'} <span aria-hidden="true">→</span></button>
        {busy && <progress value={progress} max="1" aria-label="Breath recording progress" />}
      </section>}
      {stage === 1 && <section aria-labelledby="walk-title" className="sensor-card">
        <p className="sensor-kicker">02 / WALK</p><h1 id="walk-title" ref={heading} tabIndex={-1}>Take a short walk.</h1>
        <p>Tap start, put your phone in your pocket and walk at a comfortable pace for ten seconds.</p>
        <p className="sensor-note">Motion stays on your phone. Estimated steps and cadence can vary by device.</p>
        <button disabled={busy} onClick={captureWalk}>{busy ? 'Recording movement…' : 'Start walking'} <span aria-hidden="true">→</span></button>
        {busy && <progress value={progress} max="1" aria-label="Walking recording progress" />}
      </section>}
      {stage === 2 && <section aria-labelledby="result-title" className="sensor-card">
        <p className="sensor-kicker">03 / YOUR READINGS</p><h1 id="result-title" ref={heading} tabIndex={-1}>Your check-in.</h1>
        <p>These values describe the recording. Sound levels and time above a relative threshold depend on your microphone and background noise. Estimated steps and cadence are not validated. None of these values can assess your health.</p>
        <dl className="sensor-readings">
          <div><dt>Sound above relative threshold</dt><dd>{breath.soundAboveRelativeThresholdSeconds === null ? 'Unavailable' : <>{breath.soundAboveRelativeThresholdSeconds} <small>seconds</small></>}</dd></div>
          <div><dt>Sound level (RMS)</dt><dd>{breath.breathRms}</dd></div>
          <div><dt>Estimated steps</dt><dd>{walk.stepsDetected ?? 'Unavailable'}</dd></div>
          <div><dt>Estimated cadence</dt><dd>{walk.walkingCadence === null ? 'Unavailable' : <>{walk.walkingCadence} <small>steps/min</small></>}</dd></div>
        </dl>
        <p className="sensor-note">If you choose an AI-selected note, these four numbers are sent to our server and OpenAI. No audio, raw motion samples or identifying details are sent. The readings can still be personal information.</p>
        <button disabled={busy} onClick={requestAnalysis}>{busy ? 'Getting note…' : 'Send numbers for an AI-selected note'} <span aria-hidden="true">→</span></button>
        {analysis && <div className="sensor-analysis" aria-live="polite"><h2>AI-selected note</h2><p>{analysis}</p></div>}
        <button className="sensor-secondary" disabled={busy} onClick={restart}>Start again</button>
      </section>}
      {error && <p className="sensor-error" role="alert">{error}</p>}
    </main>
    <footer>Experimental demo · Not a medical assessment</footer>
  </div>;
}
