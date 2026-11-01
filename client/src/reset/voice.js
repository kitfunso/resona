import { MINUTE_MS } from './reset.js';

const CUES = Object.freeze({ in: '/reset-voice-in.wav', out: '/reset-voice-out.wav' });
const MAX_LATE_MS = 250;

export async function voiceAssetsAvailable(fetchFile = fetch, signal) {
  try {
    const files = await Promise.all(Object.values(CUES).map((url) => fetchFile(url, { method: 'HEAD', signal })));
    return files.every((file) => file.ok && /^(audio\/|application\/octet-stream)/i.test(file.headers.get('content-type') || ''));
  } catch {
    return false;
  }
}

export function createVoiceGuide({ makeAudio = (url) => new Audio(url), onError = () => {}, now = () => performance.now() } = {}) {
  let audio = null;
  let lastPhase = null;
  let generation = 0;
  let prepared = null;
  let removeGuard = null;

  function prepare() {
    if (prepared) return;
    try {
      prepared = Object.fromEntries(Object.entries(CUES).map(([phase, url]) => {
        const cue = makeAudio(url);
        cue.preload = 'auto';
        cue.load();
        return [phase, cue];
      }));
    } catch {
      prepared = null;
      onError();
    }
  }

  function stop() {
    generation += 1;
    removeGuard?.(); removeGuard = null;
    if (audio) { audio.pause(); audio.currentTime = 0; audio = null; }
  }

  function reset() { stop(); lastPhase = null; }

  function update({ enabled, active, remaining }) {
    if (!enabled || !active || remaining <= 0) { stop(); return; }
    const elapsed = MINUTE_MS - remaining;
    const cycle = Math.floor(elapsed / 10_000);
    const offset = elapsed % 10_000;
    const isIn = offset < 4_000;
    const phase = `${cycle}-${isIn ? 'in' : 'out'}`;
    if (phase === lastPhase) return;
    lastPhase = phase;
    stop();
    const late = offset - (isIn ? 0 : 4_000);
    if (late > MAX_LATE_MS) return;
    const current = ++generation;
    const deadline = now() + MAX_LATE_MS - late;
    try {
      audio = prepared?.[isIn ? 'in' : 'out'];
      if (!audio || audio.readyState < 2) { audio = null; return; }
      const cue = audio;
      const stopIfStale = () => {
        if (current !== generation || now() > deadline) {
          if (current === generation || audio !== cue) cue.pause();
          if (current === generation && audio === cue) audio = null;
        }
      };
      cue.addEventListener('playing', stopIfStale, { once: true });
      removeGuard = () => cue.removeEventListener('playing', stopIfStale);
      Promise.resolve(cue.play()).then(stopIfStale).catch(() => { if (current === generation) onError(); });
    } catch {
      if (current === generation) onError();
    }
  }

  return { prepare, update, stop, reset };
}
