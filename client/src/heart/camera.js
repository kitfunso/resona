// Front-camera capture for Resona Module 3 (Heart, rPPG).
//
// Captures front-facing video and reads back the mean R/G/B of a small
// region-of-interest rectangle on a fixed ~30 Hz cadence. Raw pixels never
// leave the browser: the <video> element and capture <canvas> are created on
// capture and destroyed on stop. Only the numeric { samples } array is used
// downstream by rppg.js.
//
// iOS Safari constraints:
//   - getUserMedia must be reached from a user gesture; acquireCameraPermission
//     splits the OS prompt out before any countdown (mirrors recorder.js).
//   - the <video> element needs muted + playsInline + autoplay to inline-play.
//
// This file uses browser APIs (getUserMedia, canvas, requestAnimationFrame)
// and is NOT importable by the node DSP test. The pure DSP lives in rppg.js.

// Fixed sampling cadence. Camera rAF runs at the display rate (often 60 Hz);
// we gate down to ~30 Hz so each sample is a real new video frame and the
// per-frame getImageData cost stays bounded (refinement R1).
const SAMPLE_HZ = 30;
const SAMPLE_INTERVAL_MS = 1000 / SAMPLE_HZ;

// onTick cadence: ~10 Hz progress updates for the capture progress bar.
const TICK_INTERVAL_MS = 100;

// Default ROI as fractions of the video frame: a central forehead/cheek
// rectangle. The HeartView oval guide lines up with this region.
const DEFAULT_ROI = { x: 0.32, y: 0.22, w: 0.36, h: 0.30 };

// Open the OS camera dialog in isolation, then release the stream. Call this
// from the user tap BEFORE the countdown so the prompt does not pop mid-flow.
// The grant is sticky for the page session, so captureRPPG below gets an
// instant stream after this resolves. Mirrors recorder.js acquireMicPermission.
export async function acquireCameraPermission() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: false,
  });
  stream.getTracks().forEach((t) => t.stop());
}

// Build a hidden, inline-playing <video> bound to the stream.
function createVideoElement(stream) {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.autoplay = true;
  return video;
}

// Resolve once the video has real frame dimensions to sample from.
function waitForVideoReady(video) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      video.play().then(resolve).catch(reject);
    };
    if (video.readyState >= 2 && video.videoWidth > 0) {
      onReady();
      return;
    }
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', () => reject(new Error('camera video failed to load')), {
      once: true,
    });
  });
}

// Mean R, G, B over the pixels currently on the (ROI-sized) canvas.
function meanRgb(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

// Capture ~durationMs of front-camera video, sampling the ROI rectangle's mean
// RGB at a fixed ~30 Hz. Returns { samples: [{r,g,b,t}], rate, duration } with
// the same shape contract as imu/motion.js captureMotion.
//
// onTick({ elapsedMs, pct }) fires ~10 Hz for the progress bar.
// onFrameStats({ brightness }) fires per sample with a 0..1 lighting hint.
export async function captureRPPG({
  durationMs = 20000,
  roi = DEFAULT_ROI,
  onTick,
  onFrameStats,
} = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new Error('Camera API not available on this device');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: false,
  });

  const video = createVideoElement(stream);
  // Small canvas sized to the ROI only. We never getImageData a full-resolution
  // frame: drawImage downscales the ROI sub-rectangle straight into this small
  // buffer, keeping the GPU->CPU readback cheap on mobile Safari (refinement R1).
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function teardown() {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    canvas.width = 0;
    canvas.height = 0;
  }

  const samples = [];
  let rafHandle = null;
  let tickHandle = null;

  try {
    await waitForVideoReady(video);

    // ROI rectangle in source-video pixels, clamped to the frame.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const srcX = Math.max(0, Math.min(vw - 1, Math.round(roi.x * vw)));
    const srcY = Math.max(0, Math.min(vh - 1, Math.round(roi.y * vh)));
    const srcW = Math.max(1, Math.min(vw - srcX, Math.round(roi.w * vw)));
    const srcH = Math.max(1, Math.min(vh - srcY, Math.round(roi.h * vh)));

    // Downscaled destination: cap the longest ROI side at 64 px. The mean of a
    // downscaled region equals the mean of the full region for our purposes,
    // and the readback is tiny.
    const scale = Math.min(1, 64 / Math.max(srcW, srcH));
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));

    const startTs = performance.now();

    if (onTick) {
      tickHandle = setInterval(() => {
        const elapsed = performance.now() - startTs;
        onTick({ elapsedMs: elapsed, pct: Math.min(1, elapsed / durationMs) });
      }, TICK_INTERVAL_MS);
    }

    await new Promise((resolve) => {
      let nextSampleAt = 0;

      const loop = () => {
        const now = performance.now();
        const elapsed = now - startTs;

        if (elapsed >= durationMs) {
          resolve();
          return;
        }

        // Timestamp gate: sample on a fixed ~30 Hz cadence, not every rAF tick.
        if (elapsed >= nextSampleAt) {
          ctx.drawImage(
            video,
            srcX,
            srcY,
            srcW,
            srcH,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const { r, g, b } = meanRgb(ctx, canvas.width, canvas.height);
          // t is the real inter-frame timestamp; fps jitter is recorded here so
          // rppg.js resampling and effectiveFps reflect what actually happened.
          samples.push({ r, g, b, t: elapsed });
          if (onFrameStats) {
            const brightness = (r + g + b) / (3 * 255);
            onFrameStats({ brightness });
          }
          nextSampleAt += SAMPLE_INTERVAL_MS;
          // If the loop fell behind (tab throttled), do not burn a backlog.
          if (nextSampleAt < elapsed) nextSampleAt = elapsed + SAMPLE_INTERVAL_MS;
        }

        rafHandle = requestAnimationFrame(loop);
      };

      rafHandle = requestAnimationFrame(loop);
    });
  } finally {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    if (tickHandle) clearInterval(tickHandle);
    teardown();
  }

  const actualMs =
    samples.length > 0 ? samples[samples.length - 1].t - samples[0].t : 0;
  const rate = actualMs > 0 ? (samples.length - 1) / (actualMs / 1000) : 0;

  if (samples.length < 60) {
    throw new Error(
      'Not enough camera frames captured. Hold the phone steady in good light and try again.',
    );
  }

  return { samples, rate, duration: actualMs };
}
