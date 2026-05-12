// Front-camera rPPG recorder. Exposes three functions:
//   - acquireCameraPermission() prompts the OS dialog, then releases the stream
//   - detectFirstFrameRoi(video) lazy-imports MediaPipe Tasks Vision and runs
//     one face-detect pass; returns either { kind: 'face', rois } or { kind:
//     'fallback', rois } after retries are exhausted by the caller
//   - captureRppg({ video, durationMs, rois, onTick, onLiveHr }) reads ROI
//     means per frame into a flat structure ready for features.js
//
// Privacy contract: the offscreen canvas used for sampling is module-scoped
// and never appended to the DOM. Per-frame ImageData is consumed for its mean
// RGB and released. Only the timestamped ROI means survive a capture.

const TARGET_FPS = 30;
const OFFSCREEN_FOREHEAD = { w: 32, h: 32 };
const OFFSCREEN_CHEEKS = { w: 32, h: 16 };

let offscreenForehead = null;
let offscreenForeheadCtx = null;
let offscreenCheeks = null;
let offscreenCheeksCtx = null;

function getOffscreens() {
  if (!offscreenForehead) {
    offscreenForehead = document.createElement('canvas');
    offscreenForehead.width = OFFSCREEN_FOREHEAD.w;
    offscreenForehead.height = OFFSCREEN_FOREHEAD.h;
    offscreenForeheadCtx = offscreenForehead.getContext('2d', { willReadFrequently: true });
  }
  if (!offscreenCheeks) {
    offscreenCheeks = document.createElement('canvas');
    offscreenCheeks.width = OFFSCREEN_CHEEKS.w;
    offscreenCheeks.height = OFFSCREEN_CHEEKS.h;
    offscreenCheeksCtx = offscreenCheeks.getContext('2d', { willReadFrequently: true });
  }
  return {
    foreheadCanvas: offscreenForehead,
    foreheadCtx: offscreenForeheadCtx,
    cheeksCanvas: offscreenCheeks,
    cheeksCtx: offscreenCheeksCtx,
  };
}

async function getUserMediaStream() {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

export async function acquireCameraPermission() {
  const stream = await getUserMediaStream();
  stream.getTracks().forEach((t) => t.stop());
}

let faceDetectorPromise = null;
async function getFaceDetector() {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
      );
      return vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
      });
    })();
  }
  return faceDetectorPromise;
}

function roisFromBbox(bbox, videoW, videoH) {
  // bbox is { originX, originY, width, height } in video pixels.
  const fw = bbox.width * 0.5;
  const fh = bbox.height * 0.2;
  const fx = bbox.originX + (bbox.width - fw) / 2;
  const fy = bbox.originY + bbox.height * 0.05;

  const cw = bbox.width * 0.25;
  const ch = bbox.height * 0.25;
  const cy = bbox.originY + bbox.height * 0.45;
  const cxL = bbox.originX + bbox.width * 0.10;
  const cxR = bbox.originX + bbox.width * 0.65;

  // Clamp to video bounds.
  const clamp = (x, y, w, h) => ({
    x: Math.max(0, Math.min(videoW - 1, x)),
    y: Math.max(0, Math.min(videoH - 1, y)),
    w: Math.max(4, Math.min(videoW, w)),
    h: Math.max(4, Math.min(videoH, h)),
  });

  return {
    forehead: clamp(fx, fy, fw, fh),
    cheekL: clamp(cxL, cy, cw, ch),
    cheekR: clamp(cxR, cy, cw, ch),
    source: 'face',
  };
}

function fallbackRois(videoW, videoH) {
  // Centred forehead-sized patch + a strip below it.
  const fw = videoW * 0.4;
  const fh = videoH * 0.18;
  const fx = (videoW - fw) / 2;
  const fy = videoH * 0.18;

  const cw = videoW * 0.20;
  const ch = videoH * 0.18;
  const cy = videoH * 0.50;
  const cxL = videoW * 0.20;
  const cxR = videoW * 0.60;
  return {
    forehead: { x: fx, y: fy, w: fw, h: fh },
    cheekL: { x: cxL, y: cy, w: cw, h: ch },
    cheekR: { x: cxR, y: cy, w: cw, h: ch },
    source: 'fallback',
  };
}

export async function detectFirstFrameRoi(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new Error('video element not ready');
  try {
    const detector = await getFaceDetector();
    const result = detector.detect(videoEl);
    const det = result?.detections?.[0];
    if (det?.boundingBox) {
      return { kind: 'face', rois: roisFromBbox(det.boundingBox, w, h) };
    }
  } catch (err) {
    console.warn('[heart] face-detect failed, will allow caller to retry:', err.message);
  }
  return { kind: 'no-face' };
}

export function buildFallbackRois(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  return { kind: 'fallback', rois: fallbackRois(w, h) };
}

function drawRoiMean(ctx, video, roi, dstW, dstH) {
  // Drawing into a fixed-size offscreen canvas averages neighbourhood pixels
  // for free via the browser's downscale. Read mean R,G,B in [0,1].
  ctx.clearRect(0, 0, dstW, dstH);
  ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, dstW, dstH);
  const img = ctx.getImageData(0, 0, dstW, dstH).data;
  let r = 0, g = 0, b = 0;
  const n = dstW * dstH;
  for (let i = 0; i < img.length; i += 4) {
    r += img[i];
    g += img[i + 1];
    b += img[i + 2];
  }
  return { r: r / (n * 255), g: g / (n * 255), b: b / (n * 255) };
}

export async function captureRppg({ videoEl, durationMs, rois, onTick, onLiveHr }) {
  const { foreheadCtx, cheeksCtx } = getOffscreens();
  const startMs = performance.now();
  const samples = {
    t: [],
    forehead: { r: [], g: [], b: [] },
    cheeks: { r: [], g: [], b: [] },
  };

  // Live HR uses a rolling tail of the forehead-green channel and is
  // intentionally rough; the final HR comes from features.js post-capture.
  const liveTailFrames = TARGET_FPS * 8;

  return new Promise((resolve) => {
    let rafId = null;
    function loop() {
      const now = performance.now();
      const elapsed = now - startMs;
      const pct = Math.min(1, elapsed / durationMs);

      // Forehead mean.
      const fMean = drawRoiMean(foreheadCtx, videoEl, rois.forehead, OFFSCREEN_FOREHEAD.w, OFFSCREEN_FOREHEAD.h);
      // Cheeks: draw both rectangles into the same strip so we get a combined mean.
      cheeksCtx.clearRect(0, 0, OFFSCREEN_CHEEKS.w, OFFSCREEN_CHEEKS.h);
      cheeksCtx.drawImage(videoEl,
        rois.cheekL.x, rois.cheekL.y, rois.cheekL.w, rois.cheekL.h,
        0, 0, OFFSCREEN_CHEEKS.w / 2, OFFSCREEN_CHEEKS.h);
      cheeksCtx.drawImage(videoEl,
        rois.cheekR.x, rois.cheekR.y, rois.cheekR.w, rois.cheekR.h,
        OFFSCREEN_CHEEKS.w / 2, 0, OFFSCREEN_CHEEKS.w / 2, OFFSCREEN_CHEEKS.h);
      const cImg = cheeksCtx.getImageData(0, 0, OFFSCREEN_CHEEKS.w, OFFSCREEN_CHEEKS.h).data;
      let cr = 0, cg = 0, cb = 0;
      const cn = OFFSCREEN_CHEEKS.w * OFFSCREEN_CHEEKS.h;
      for (let i = 0; i < cImg.length; i += 4) { cr += cImg[i]; cg += cImg[i + 1]; cb += cImg[i + 2]; }
      cr /= cn * 255; cg /= cn * 255; cb /= cn * 255;

      samples.t.push(elapsed);
      samples.forehead.r.push(fMean.r);
      samples.forehead.g.push(fMean.g);
      samples.forehead.b.push(fMean.b);
      samples.cheeks.r.push(cr);
      samples.cheeks.g.push(cg);
      samples.cheeks.b.push(cb);

      if (onTick) onTick({ pct, elapsedMs: elapsed });

      // Live HR every ~1s once we have at least 5s of samples.
      const nFrames = samples.t.length;
      if (onLiveHr && nFrames >= TARGET_FPS * 5 && nFrames % TARGET_FPS === 0) {
        const tailStart = Math.max(0, nFrames - liveTailFrames);
        let sum = 0;
        for (let i = tailStart; i < nFrames; i++) sum += samples.forehead.g[i];
        const mean = sum / (nFrames - tailStart);
        let zc = 0;
        let prev = samples.forehead.g[tailStart] - mean;
        for (let i = tailStart + 1; i < nFrames; i++) {
          const v = samples.forehead.g[i] - mean;
          if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) zc++;
          prev = v;
        }
        const beats = zc / 2;
        const windowSec = (samples.t[nFrames - 1] - samples.t[tailStart]) / 1000;
        const bpm = windowSec > 0 ? (beats / windowSec) * 60 : 0;
        if (bpm >= 40 && bpm <= 200) onLiveHr(bpm);
      }

      if (elapsed >= durationMs) {
        // Convert per-channel JS arrays to Float32Array for downstream POS.
        resolve({
          samples: {
            t: Float32Array.from(samples.t),
            forehead: {
              r: Float32Array.from(samples.forehead.r),
              g: Float32Array.from(samples.forehead.g),
              b: Float32Array.from(samples.forehead.b),
            },
            cheeks: {
              r: Float32Array.from(samples.cheeks.r),
              g: Float32Array.from(samples.cheeks.g),
              b: Float32Array.from(samples.cheeks.b),
            },
          },
          durationSec: elapsed / 1000,
          roiSource: rois.source,
        });
        if (rafId) cancelAnimationFrame(rafId);
        return;
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  });
}
