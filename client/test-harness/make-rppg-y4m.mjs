// Generate a synthetic rPPG test video for the fake-camera browser test.
//
// Writes a Y4M (uncompressed) the browser plays as a fake webcam via Chromium's
// --use-file-for-fake-video-capture. Each frame is a single skin-tone colour
// whose GREEN channel oscillates at the target heart rate, with only tiny R/B
// modulation. This mimics a real blood-volume pulse (green absorption changes
// most) — and, crucially, a *channel-differential* signal, because POS by
// design cancels modulation that hits all channels equally (lighting/motion).
//
// 72 bpm over exactly 30 s = 36 whole cycles, so the file loops seamlessly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const W = 128, H = 96, FPS = 30, DURATION_SEC = 30, BPM = 72;
const pulseHz = BPM / 60;
const base = { r: 190, g: 150, b: 130 };
const amp = { r: 0.6, g: 3.0, b: 0.6 }; // green-dominant

// JPEG/full-range BT.601 RGB->YCbCr (matches C420jpeg).
function rgb2yuv(r, g, b) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  return {
    y: clamp(0.299 * r + 0.587 * g + 0.114 * b),
    u: clamp(-0.168736 * r - 0.331264 * g + 0.5 * b + 128),
    v: clamp(0.5 * r - 0.418688 * g - 0.081312 * b + 128),
  };
}

const ySize = W * H;
const cSize = (W / 2) * (H / 2);
const nFrames = FPS * DURATION_SEC;
const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`, 'ascii');
const frameMarker = Buffer.from('FRAME\n', 'ascii');

const chunks = [header];
for (let i = 0; i < nFrames; i++) {
  const t = i / FPS;
  const s = Math.sin(2 * Math.PI * pulseHz * t);
  const { y, u, v } = rgb2yuv(base.r + amp.r * s, base.g + amp.g * s, base.b + amp.b * s);
  chunks.push(frameMarker, Buffer.alloc(ySize, y), Buffer.alloc(cSize, u), Buffer.alloc(cSize, v));
}

const out = path.join(__dirname, 'rppg-72bpm.y4m');
fs.writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${out}: ${nFrames} frames ${W}x${H} @${FPS}fps, ${BPM} bpm, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
