// Run against a local Vite server with PLAYWRIGHT_PATH set if Playwright is not installed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.RESONA_TEST_URL || 'http://127.0.0.1:5196';
const report = { source: 'codex', headline: 'Synthetic report', interpretation: 'A test reading.', actions: [] };
const requests = [];
let failNextReport = false;
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

try {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 }, permissions: ['microphone', 'camera'] });
  const page = await context.newPage();
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { id: 'synthetic-guest' } } }));
  await page.route('**/health', (route) => route.fulfill({ json: { codexAnalytics: true } }));
  await page.route('**/api/analyze-*', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    requests.push({ path, body });
    if (failNextReport) {
      failNextReport = false;
      return route.fulfill({ status: 503, json: { error: 'Synthetic provider failure' } });
    }
    const result = path.endsWith('blow') ? { personalReport: report } : { report };
    return route.fulfill({ json: result });
  });
  await page.route('**/src/audio/features.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'let count = 0; export const extractFeatures = () => ++count === 1 ? ({peakEnv: 0, rmsEnergy: 0, activeSec10: 0}) : ({peakEnv: 0.4, rmsEnergy: 0.2, activeSec10: 3});' }));
  await page.route('**/src/imu/motion.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const requestMotionPermission = async () => "granted"; export const captureMotion = async () => ({ synthetic: true });' }));
  await page.route('**/src/imu/tremor.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const analyseTremor = () => ({ dominantFrequencyHz: 6, sampleRate: 50 });' }));
  await page.route('**/src/imu/gait.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const analyseGait = () => ({ stepsDetected: 20, cadence: 120, stridesCv: 0.1, symmetryIndex: 0.9 });' }));
  await page.route('**/src/video/recorder.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const acquireCameraPermission = async () => {}; export const detectFirstFrameRoi = async () => ({kind: "face", rois: []}); export const buildFallbackRois = () => ({rois: []}); export const captureRppg = async () => ({samples: [], durationSec: 30, roiSource: "face"});' }));
  await page.route('**/src/video/features.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const extractHeartFeatures = () => ({hrBpm: 72, hrvRmssdMs: 40, sdnnMs: 35, beatCount: 36, durationSec: 30, grade: "good", reasons: []});' }));

  await page.goto(origin, { waitUntil: 'networkidle' });
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 740 });
    const layout = await page.evaluate(() => {
      const bounds = (selector) => document.querySelector(selector).getBoundingClientRect();
      const header = bounds('.r-chrome');
      const hero = bounds('.r-hero');
      const brand = bounds('.r-chrome-brand');
      const actions = bounds('.r-chrome-actions');
      const disclaimer = bounds('.r-chrome-disclaimer');
      return { headerBottom: header.bottom, heroTop: hero.top, brandRight: brand.right, actionsLeft: actions.left, disclaimerTop: disclaimer.top, rowBottom: Math.max(brand.bottom, actions.bottom), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.headerBottom <= layout.heroTop, `Header overlaps hero at ${width}px`);
    assert.ok(layout.brandRight <= layout.actionsLeft, `Header controls overlap at ${width}px`);
    assert.ok(layout.disclaimerTop >= layout.rowBottom, `Header disclaimer overlaps controls at ${width}px`);
    assert.equal(layout.overflow, false, `Page overflows at ${width}px`);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  const consent = page.getByRole('checkbox', { name: /send my numerical readings for automatic codex reports/i });
  assert.equal(await consent.isChecked(), true, 'Automatic reports must start enabled');
  await page.getByText(/starting a recording sends your numerical readings to our server and openai/i).waitFor();
  assert.equal(requests.length, 0, 'The default setting must not send a report before capture');
  await page.getByRole('button', { name: /tap to begin/i }).click();
  await page.getByRole('button', { name: /tap to blow/i }).click();
  await page.getByText('Sound duration above relative threshold').waitFor({ timeout: 15000 });
  assert.equal(requests.length, 0, 'A silent recording must not send a report');
  await page.getByText(/no clear breath sound was captured/i).waitFor();
  await page.getByRole('button', { name: /blow again/i }).click();
  await consent.uncheck();
  await page.getByRole('button', { name: /tap to begin/i }).click();
  await page.getByRole('button', { name: /tap to blow/i }).click();
  await page.getByText('Your recording is ready.').waitFor({ timeout: 15000 });
  assert.equal(requests.length, 0, 'An unchecked consent box must not send a report');
  await page.getByText(/local report/i).first().waitFor();
  await page.getByRole('button', { name: /blow again/i }).click();
  await consent.check();
  assert.equal(requests.length, 0, 'Changing the setting alone must not send a report');
  failNextReport = true;
  await page.getByRole('button', { name: /tap to begin/i }).click();
  await page.getByRole('button', { name: /tap to blow/i }).click();
  await page.getByText(/codex report is unavailable/i).waitFor({ timeout: 15000 });
  assert.equal(requests.length, 1, 'A provider failure must not trigger a paid retry');
  await page.getByRole('button', { name: /retry codex report/i }).click();
  await page.getByText('Synthetic report').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => { const rect = document.querySelector('.rv-report')?.getBoundingClientRect(); return rect && rect.top < innerHeight && rect.bottom > 0; });
  assert.deepEqual(requests.map(({ path }) => path), ['/api/analyze-blow', '/api/analyze-blow']);
  assert.deepEqual(Object.keys(requests[1].body), ['features']);
  assert.deepEqual(requests[1].body, requests[0].body, 'A deliberate retry must reuse the recorded features');
  await page.getByRole('button', { name: /try the neuro screen/i }).click();
  failNextReport = true;
  await page.getByRole('button', { name: /start stillness test/i }).click();
  await page.getByRole('button', { name: /start walk test/i }).waitFor({ timeout: 20000 });
  await page.getByText(/stillness report/i).waitFor();
  await page.getByText(/the codex model report is unavailable/i).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => { const rect = [...document.querySelectorAll('.nv-report')].at(-1)?.getBoundingClientRect(); return rect && rect.top < innerHeight && rect.bottom > 0; });
  assert.equal(requests.length, 3, 'Stillness failure must not trigger an automatic retry');
  assert.equal(requests[2].path, '/api/analyze-neuro');
  assert.deepEqual(Object.keys(requests[2].body).sort(), ['gait', 'tremor']);
  assert.equal(requests[2].body.gait, null);
  await page.getByRole('button', { name: /retry codex report/i }).click();
  await page.getByText('Synthetic report').waitFor({ timeout: 15000 });
  assert.deepEqual(requests[3].body, requests[2].body, 'Stillness retry must reuse the recorded features');
  await page.getByRole('button', { name: /start walk test/i }).click();
  await page.waitForFunction(() => { const reports = [...document.querySelectorAll('.nv-report')]; const last = reports.at(-1); const rect = last?.getBoundingClientRect(); return reports.length >= 2 && last.textContent.includes('Synthetic report') && rect.top < innerHeight && rect.bottom > 0; }, null, { timeout: 20000 });
  assert.deepEqual(requests.map(({ path }) => path), ['/api/analyze-blow', '/api/analyze-blow', '/api/analyze-neuro', '/api/analyze-neuro', '/api/analyze-neuro']);
  assert.deepEqual(Object.keys(requests[4].body).sort(), ['gait', 'tremor']);
  assert.equal(requests[4].body.gait.stepsDetected, 20);
  await page.getByRole('button', { name: /try the heart screen/i }).click();
  await page.getByRole('button', { name: /start heart screen/i }).click();
  await page.getByText('Synthetic report').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => { const rect = document.querySelector('.hv-report')?.getBoundingClientRect(); return rect && rect.top < innerHeight && rect.bottom > 0; });
  assert.deepEqual(requests.map(({ path }) => path), ['/api/analyze-blow', '/api/analyze-blow', '/api/analyze-neuro', '/api/analyze-neuro', '/api/analyze-neuro', '/api/analyze-heart']);
  assert.deepEqual(Object.keys(requests[5].body), ['heart']);
  await page.getByText(/you have tried all three modules/i).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Phone viewport should not overflow');
  console.log('Automatic reports, consent, numeric-only payloads and remaining-module flow passed.');
  await context.close();
} finally {
  await browser.close();
}
