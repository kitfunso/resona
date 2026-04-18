// MediaRecorder wrapper for forced-exhalation capture.
// iOS Safari constraint: AudioContext must be created from a direct user gesture.
// Call `unlockAudio()` from a button onClick handler before the first capture.

let audioContextSingleton = null;

export function unlockAudio() {
  if (audioContextSingleton) return audioContextSingleton;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Web Audio API not supported on this device');
  }
  audioContextSingleton = new Ctor();
  // Resume in case the browser created it in "suspended" state.
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
