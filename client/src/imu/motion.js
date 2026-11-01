// DeviceMotion capture for Resona Module 2 (Neuro).
//
// iOS 13+ requires an explicit permission request triggered from a user
// gesture. Android/desktop browsers fire devicemotion events directly.
// Typical iOS Safari sample rate is ~60 Hz; Android varies 50-100 Hz.

function isIosPermissionApi() {
  return (
    typeof window !== 'undefined' &&
    typeof window.DeviceMotionEvent !== 'undefined' &&
    typeof window.DeviceMotionEvent.requestPermission === 'function'
  );
}

export async function requestMotionPermission() {
  if (!isIosPermissionApi()) return 'granted';
  const state = await window.DeviceMotionEvent.requestPermission();
  return state; // 'granted' | 'denied'
}

// Returns { samples: [{ax, ay, az, t}], rate: approx Hz, duration: ms }.
// Captures in accelerationIncludingGravity (most widely supported), which gives
// us gravity-dominated vertical axis for gait and full magnitude for tremor.
export async function captureMotion({ durationMs = 10000, onTick, signal } = {}) {
  if (typeof window === 'undefined' || typeof window.DeviceMotionEvent === 'undefined') {
    throw new Error('DeviceMotion API not available on this device');
  }

  const samples = [];
  const startTs = performance.now();
  let tickHandle = null;

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    samples.push({ ax: a.x, ay: a.y, az: a.z, t: performance.now() - startTs });
  }

  if (signal?.aborted) throw new DOMException('Capture stopped', 'AbortError');
  window.addEventListener('devicemotion', onMotion);

  if (onTick) {
    tickHandle = setInterval(() => {
      const elapsed = performance.now() - startTs;
      onTick({ elapsedMs: elapsed, pct: Math.min(1, elapsed / durationMs) });
    }, 100);
  }

  try {
    await new Promise((resolve, reject) => {
      const handle = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, durationMs);
      const abort = () => { clearTimeout(handle); signal?.removeEventListener('abort', abort); reject(new DOMException('Capture stopped', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  } finally {
    window.removeEventListener('devicemotion', onMotion);
    if (tickHandle) clearInterval(tickHandle);
  }

  const actualMs = samples.length > 0 ? samples[samples.length - 1].t - samples[0].t : 0;
  const rate = actualMs > 0 ? (samples.length - 1) / (actualMs / 1000) : 0;

  if (samples.length < 20) {
    throw new Error(
      'No motion data received. On iOS you may need to grant Motion & Orientation Access in Settings > Safari.',
    );
  }

  return { samples, rate, duration: actualMs };
}
