// MediaRecorder wrapper for forced-exhalation capture.
// iOS Safari constraint: AudioContext must be created from a direct user gesture.
// Call `unlockAudio()` from a button onClick handler before the first capture.

let audioContextSingleton = null;

export function unlockAudio() {
  if (audioContextSingleton) {
    // Already created. Still worth kicking resume() each tap in case iOS
    // re-suspended it (happens when the tab loses focus or after long idle).
    if (audioContextSingleton.state === 'suspended') {
      audioContextSingleton.resume();
    }
    return audioContextSingleton;
  }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Web Audio API not supported on this device');
  }
  audioContextSingleton = new Ctor();
  // iOS Safari unlock pattern: creating the context is not enough. You must
  // also play an actual AudioBufferSourceNode within the user-gesture tick
  // for the context to transition from "suspended" to "running". A single
  // sample of silence at 22050 Hz is the canonical trick.
  try {
    const buf = audioContextSingleton.createBuffer(1, 1, 22050);
    const src = audioContextSingleton.createBufferSource();
    src.buffer = buf;
    src.connect(audioContextSingleton.destination);
    src.start(0);
  } catch { /* ignore */ }
  if (audioContextSingleton.state === 'suspended') {
    audioContextSingleton.resume();
  }
  return audioContextSingleton;
}

export function getAudioContext() {
  if (!audioContextSingleton) {
    throw new Error('AudioContext not unlocked, call unlockAudio() from a user tap first');
  }
  return audioContextSingleton;
}

async function getUserMediaStream() {
  const constraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
    video: false,
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

// Trigger the mic permission dialog in isolation, then release the stream.
// Call this from the user tap, BEFORE any countdown, so the OS prompt does
// not pop mid-countdown. The permission grant is sticky for the page session,
// so recordBlow() below gets an instant stream after this resolves.
export async function acquireMicPermission() {
  const stream = await getUserMediaStream();
  stream.getTracks().forEach((t) => t.stop());
}

// Records `durationMs` of raw mono PCM from the mic.
// Returns { pcm: Float32Array, sampleRate: number }.
//
// onTick(pct, elapsedMs) fires ~10 Hz with recording progress.
// onLevel(peak) fires ~60 Hz with instantaneous mic level in [0, 1]. Use for
// a live VU meter so the user can see their blow is actually being captured.
export async function recordBlow({ durationMs = 6000, onTick, onLevel } = {}) {
  const ctx = getAudioContext();
  const stream = await getUserMediaStream();
  const source = ctx.createMediaStreamSource(stream);

  // Live level monitoring via an AnalyserNode tapped off the mic source.
  let analyser = null;
  let levelRaf = null;
  if (onLevel) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      // Peak deviation from 128 (unsigned 8-bit midpoint).
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      onLevel(peak);
      levelRaf = requestAnimationFrame(tick);
    };
    levelRaf = requestAnimationFrame(tick);
  }

  const chunks = [];
  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const startTs = performance.now();
  const tickHandle = onTick
    ? setInterval(() => {
        const elapsed = performance.now() - startTs;
        const pct = Math.min(1, elapsed / durationMs);
        onTick({ elapsedMs: elapsed, pct });
      }, 100)
    : null;

  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  recorder.stop();
  await new Promise((resolve) => {
    recorder.addEventListener('stop', resolve, { once: true });
  });
  if (tickHandle) clearInterval(tickHandle);
  if (levelRaf) cancelAnimationFrame(levelRaf);
  if (analyser) {
    try { source.disconnect(analyser); } catch {}
    try { analyser.disconnect(); } catch {}
  }

  stream.getTracks().forEach((t) => t.stop());
  source.disconnect();

  const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const pcm = audioBuffer.getChannelData(0);
  return { pcm: new Float32Array(pcm), sampleRate: audioBuffer.sampleRate };
}
