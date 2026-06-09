// End-to-end browser test for the rPPG capture path (recorder.js) using a fake
// camera fed a synthetic pulsatile Y4M. Validates the camera->canvas->ROI-mean
// seam the node unit tests cannot reach, end-to-end into features.js.
//
// Self-contained: serves the client/ dir over a short-lived static server (the
// pipeline modules use only relative imports, so no vite/bundler is needed),
// launches Chromium with a fake camera, runs one capture, asserts the recovered
// HR matches the synthetic video.
//
// Prereq: `node client/test-harness/make-rppg-y4m.mjs` (writes the Y4M).
// Usage:  node client/test-harness/recorder.e2e.mjs

import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.join(__dirname, '..');
const Y4M = path.join(__dirname, 'rppg-72bpm.y4m');
const PORT = 5199;
const PAGE_URL = `http://localhost:${PORT}/test-harness/rppg-harness.html`;
const TRUE_BPM = 72;
const TOL_BPM = 6;

if (!fs.existsSync(Y4M)) {
  console.error(`missing ${Y4M} — run: node client/test-harness/make-rppg-y4m.mjs`);
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = path.normalize(path.join(CLIENT_ROOT, urlPath));
  if (!filePath.startsWith(CLIENT_ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`static server on ${PAGE_URL}`);

const browser = await chromium.launch({
  headless: false, // headed avoids rAF/background throttling that would starve the capture loop
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${Y4M}`,
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

try {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__RESULT__ !== undefined, { timeout: 45000 });
  const r = await page.evaluate(() => window.__RESULT__);
  console.log('RESULT', JSON.stringify(r));

  if (r.error) {
    console.error(`FAIL: harness error: ${r.error}`);
    process.exitCode = 1;
  } else {
    const hrOk = r.hrBpm != null && Math.abs(r.hrBpm - TRUE_BPM) <= TOL_BPM;
    const pathOk = r.roiSource === 'fallback' && r.framesUsed >= 600;
    if (hrOk && pathOk) {
      console.log(`PASS: camera path recovered hr=${r.hrBpm.toFixed(1)} bpm (true ${TRUE_BPM}+/-${TOL_BPM}), grade=${r.grade}, frames=${r.framesUsed}, snr=${r.snr?.toFixed(1)}`);
    } else {
      console.error(`FAIL: hr=${r.hrBpm} (true ${TRUE_BPM}+/-${TOL_BPM}), roiSource=${r.roiSource}, frames=${r.framesUsed}, grade=${r.grade}, reasons=${JSON.stringify(r.reasons)}`);
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
  server.close();
}
