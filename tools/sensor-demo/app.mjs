import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createStaticHandler } from './static.mjs';

const LIMIT = 3;
const MAX_BODY_BYTES = 1024;
const FIELDS = Object.freeze({
  soundAboveRelativeThresholdSeconds: { min: 0, max: 30 },
  breathRms: { min: 0, max: 1 },
  walkingCadence: { min: 0, max: 300 },
  stepsDetected: { min: 0, max: 300, integer: true },
});
const INSTRUCTIONS = 'Choose a useful, non-medical next action for these demo sensor readings. RMS is an uncalibrated microphone signal level; soundAboveRelativeThresholdSeconds is time above a relative amplitude threshold and can include background sound. Neither measures breathing health. Walking cadence is an unvalidated step-detection estimate. Use repeat_walk only if walkingCadence or stepsDetected is present, quiet_place only if a sound field is present, otherwise none. Do not infer health or give medical advice.';
const FORMAT = Object.freeze({
  type: 'json_schema', name: 'sensor_observation', strict: true,
  schema: { type: 'object', properties: { nextAction: { type: 'string', enum: ['repeat_walk', 'quiet_place', 'none'] } }, required: ['nextAction'], additionalProperties: false },
});

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function authorised(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function validateReadings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !Object.hasOwn(FIELDS, key))) return null;
  const result = {};
  for (const [key, limits] of Object.entries(FIELDS)) {
    const number = value[key];
    if (number === undefined || number === null) continue;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < limits.min || number > limits.max || (limits.integer && !Number.isInteger(number))) return null;
    result[key] = number;
  }
  return Object.keys(result).length ? result : null;
}

async function readBody(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

function responseText(result) {
  const content = result.output?.filter((item) => item.type === 'message').flatMap((item) => item.content || []) || [];
  return content.filter((item) => item.type === 'output_text').map((item) => item.text).join(' ').trim();
}

async function requestAnalysis(readings, apiKey, fetchImpl) {
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-6-luna', reasoning: { effort: 'none' }, max_output_tokens: 180, store: false, instructions: INSTRUCTIONS, input: JSON.stringify(readings), text: { format: FORMAT } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Provider request failed');
  const text = responseText(await response.json());
  const result = JSON.parse(text);
  if (!result || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'nextAction')) throw new Error('Provider response unsuitable');
  const hasSound = Object.hasOwn(readings, 'breathRms') || Object.hasOwn(readings, 'soundAboveRelativeThresholdSeconds');
  const hasWalk = Object.hasOwn(readings, 'walkingCadence') || Object.hasOwn(readings, 'stepsDetected');
  const actions = {
    repeat_walk: hasWalk ? 'If you repeat the walk, keep the phone in the same position.' : null,
    quiet_place: hasSound ? 'If you repeat the sound recording, choose a quiet place.' : null,
    none: 'You can keep these readings as a snapshot of this recording.',
  };
  const action = Object.hasOwn(actions, result.nextAction) ? actions[result.nextAction] : null;
  if (!action) throw new Error('Provider response unsuitable');
  return `${action} Sound levels can include background noise, and detected cadence is approximate. These readings are not a medical assessment.`;
}

export function createAnalyticsServer({ apiKey, accessToken, fetchImpl = fetch, staticDir } = {}) {
  if (!apiKey || !/^[A-Za-z0-9_-]{32,}$/.test(accessToken || '')) throw new Error('Missing API key or secure access token');
  const serveStatic = staticDir ? createStaticHandler(staticDir) : null;
  let attempts = 0;
  return createServer(async (req, res) => {
    if (serveStatic && await serveStatic(req, res)) return;
    if (req.method !== 'POST' || req.url !== '/api/sensor-analysis') return send(res, 404, { error: 'Not found.' });
    if (!authorised(req.headers.authorization, accessToken)) return send(res, 401, { error: 'Access denied.' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Use JSON for the readings.' });
    let payload;
    try {
      payload = await readBody(req);
    } catch {
      if (!req.aborted && !res.destroyed) send(res, 400, { error: 'The readings could not be accepted.' });
      return;
    }
    const readings = validateReadings(payload);
    if (!readings) return send(res, 400, { error: 'The readings could not be accepted.' });
    if (attempts >= LIMIT) return send(res, 429, { error: 'The demo analysis limit has been reached.' });
    attempts += 1;
    try {
      const analysis = await requestAnalysis(readings, apiKey, fetchImpl);
      return send(res, 200, { analysis });
    } catch {
      return send(res, 503, { error: 'Analysis is unavailable. Your readings are still shown on this device.' });
    }
  });
}
