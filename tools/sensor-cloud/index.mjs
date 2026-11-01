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

function json(status, data) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
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

async function authorised(header, token) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token || '') || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = header.slice(7);
  if (given.length !== token.length) return false;
  const bytes = new TextEncoder();
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const inputKey = await crypto.subtle.importKey('raw', bytes.encode(given), algorithm, false, ['sign']);
  const expectedKey = await crypto.subtle.importKey('raw', bytes.encode(token), algorithm, false, ['verify']);
  const challenge = bytes.encode('resona-sensor-demo');
  const signature = await crypto.subtle.sign('HMAC', inputKey, challenge);
  return crypto.subtle.verify('HMAC', expectedKey, signature, challenge);
}

async function readBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return null; }
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
  const result = JSON.parse(responseText(await response.json()));
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

export class AnalysisQuota {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS demo_quota (id INTEGER PRIMARY KEY CHECK (id = 1), attempts INTEGER NOT NULL)');
  }

  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/reserve') return json(404, { error: 'Not found.' });
    const rows = this.sql.exec('INSERT INTO demo_quota (id, attempts) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 3 RETURNING attempts').toArray();
    return rows.length ? json(200, { reserved: true }) : json(429, { error: 'The demo analysis limit has been reached.' });
  }
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/api/sensor-analysis') {
    if (!['GET', 'HEAD'].includes(request.method)) return json(404, { error: 'Not found.' });
    if (pathname !== '/' && pathname !== '/sensor' && pathname !== '/sensor.html' && !/^\/assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(js|css)$/.test(pathname)) return json(404, { error: 'Not found.' });
    const url = new URL(request.url);
    if (pathname === '/') url.pathname = '/sensor.html';
    return env.ASSETS.fetch(new Request(url, request));
  }
  if (request.method !== 'POST') return json(404, { error: 'Not found.' });
  if (!env.OPENAI_API_KEY || !env.SENSOR_ACCESS_TOKEN || !env.QUOTA) return json(503, { error: 'Analysis is not configured.' });
  if (!(await authorised(request.headers.get('authorization'), env.SENSOR_ACCESS_TOKEN))) return json(401, { error: 'Access denied.' });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json(415, { error: 'Use JSON for the readings.' });
  const readings = validateReadings(await readBody(request));
  if (!readings) return json(400, { error: 'The readings could not be accepted.' });
  try {
    const id = env.QUOTA.idFromName('resona-sensor-demo');
    const reservation = await env.QUOTA.get(id).fetch('https://quota.invalid/reserve', { method: 'POST' });
    if (reservation.status === 429) return json(429, { error: 'The demo analysis limit has been reached.' });
    if (!reservation.ok) throw new Error('Quota unavailable');
    const analysis = await requestAnalysis(readings, env.OPENAI_API_KEY, fetchImpl);
    return json(200, { analysis });
  } catch {
    return json(503, { error: 'Analysis is unavailable. Your readings are still shown on this device.' });
  }
}

export default { fetch(request, env) { return handleRequest(request, env); } };
