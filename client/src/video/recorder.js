// rPPG camera capture for Resona Module 03 (Heart).
//
// Streams the front camera, draws each frame into a small offscreen canvas,
// and computes the mean of the green channel inside a centred forehead ROI.
// We keep ONLY the per-frame green-channel mean (one float per frame, plus a
// timestamp) and the per-frame timestamps. No raw frames, no pixels, no image
// data ever leave this module: only the numeric trace goes to feature
// extraction.
//
// Heart rate shows up in the green channel because oxyhaemoglobin absorbs
// strongly around 530nm, so when capillaries dilate with each heartbeat the
// reflected green light dips. The signal is small (~0.5% of mean intensity),
// so we ROI-average over a face region rather than sampling a single pixel.

const ROI_CANVAS_SIZE = 64; // resample to 64x64 — enough resolution for a mean
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;

let canvasSingleton = null;
let canvasCtxSingleton = null;

function ensureCanvas() {
  if (!canvasSingleton) {
    canvasSingleton = document.createElement('canvas');
    canvasSingleton.width = ROI_CANVAS_SIZE;
    canvasSingleton.height = ROI_CANVAS_SIZE;
    canvasCtxSingleton = canvasSingleton.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: canvasSingleton, ctx: canvasCtxSingleton };
}

async function getCameraStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: DEFAULT_WIDTH },
      height: { ideal: DEFAULT_HEIGHT },
      frameRate: { ideal: 30, max: 60 },
    },
  });
}

// Fires the camera permission prompt in isolation, then releases the stream.
// Call BEFORE the prep countdown so the OS dialog does not interrupt timing.
// The grant is sticky for the page session so captureRppg() gets an instant
// stream afterwards.
export async function acquireCameraPermission() {
  const stream = await getCameraStream();
  stream.getTracks().forEach((t) => t.stop());
}

// Captures `durationMs` of rPPG signal. Returns
//   { samples, timestamps, fps, framesUsed, durationSec }
// where samples[i] is the green-channel mean of the forehead ROI at
// timestamps[i] (ms from capture start).
//
// videoElement: an attached <video> element the view will use to render the
// preview. If omitted, a hidden video is created. Either way it's wired to
// the same MediaStream.
// onTick(pct, elapsedMs, frames): ~10 Hz progress fire for the UI bar.
// onSample(gMean, tMs, idx): per-frame green sample fire (use for a live
// scrolling waveform / live HR estimate).
export async function captureRppg({
  durationMs = 30000,
  videoElement = null,
  onTick,
  onSample,
} = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available on this device');
  }
  const stream = await getCameraStream();
  const video = videoElement || document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');
  try {
    await video.play();
  } catch (err) {
    // Safari sometimes rejects play() until metadata arrives; wait + retry.
    await new Promise((r) => setTimeout(r, 80));
    await video.play();
  }

  const { canvas, ctx } = ensureCanvas();

  const samples = [];
  const timestamps = [];
  const startTs = performance.now();
  let stopped = false;
  let rafHandle = null;
  let tickHandle = null;

  function sampleFrame() {
    if (stopped) return;
    const elapsed = performance.now() - startTs;
    if (elapsed >= durationMs) {
      stopped = true;
      return;
    }
    const vw = video.videoWidth || DEFAULT_WIDTH;
    const vh = video.videoHeight || DEFAULT_HEIGHT;
    // Forehead-ish ROI: 30%–70% horizontally, 20%–65% vertically of the frame.
    // We do not face-detect; we trust the participant to centre their face in
    // the on-screen oval guide. This is hackathon-grade rPPG, not clinical.
    const sx = vw * 0.30;
    const sy = vh * 0.20;
    const sw = vw * 0.40;
    const sh = vh * 0.45;
    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = img.data;
      let gSum = 0;
      const px = canvas.width * canvas.height;
      for (let i = 0; i < data.length; i += 4) gSum += data[i + 1];
      const gMean = gSum / px;
      samples.push(gMean);
      timestamps.push(elapsed);
      if (onSample) onSample(gMean, elapsed, samples.length);
    } catch {
      // Skip this frame if the canvas is tainted or the video is mid-resize.
    }
    rafHandle = requestAnimationFrame(sampleFrame);
  }

  if (onTick) {
    tickHandle = setInterval(() => {
      const elapsed = performance.now() - startTs;
      onTick({
        elapsedMs: elapsed,
        pct: Math.min(1, elapsed / durationMs),
        frames: samples.length,
      });
    }, 100);
  }

  rafHandle = requestAnimationFrame(sampleFrame);
  await new Promise((r) => setTimeout(r, durationMs + 120));
  stopped = true;
  if (rafHandle) cancelAnimationFrame(rafHandle);
  if (tickHandle) clearInterval(tickHandle);

  stream.getTracks().forEach((t) => t.stop());
  try { video.srcObject = null; } catch { /* ignore */ }

  const actualMs =
    timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;
  const fps = actualMs > 0 ? (timestamps.length - 1) / (actualMs / 1000) : 0;

  if (samples.length < 90) {
    throw new Error(
      'Camera produced too few frames. Make sure the lens is unobstructed and try again in better light.',
    );
  }

  return {
    samples: Float32Array.from(samples),
    timestamps: Float32Array.from(timestamps),
    fps,
    framesUsed: samples.length,
    durationSec: actualMs / 1000,
  };
}
