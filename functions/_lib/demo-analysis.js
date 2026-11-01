const FIELDS = Object.freeze({
  breath: { rmsEnergy: [0, 10], activeSec10: [0, 30], peakEnv: [0, 10] },
  motion: { dominantFrequencyHz: [0, 100], sampleRate: [0, 500], stepsDetected: [0, 300, true], cadence: [0, 300], stridesCv: [0, 10], symmetryIndex: [0, 1] },
  heart: { hrBpm: [0, 300], beatCount: [0, 300, true], durationSec: [0, 120] },
});

export async function readAnalysisBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function pickReadings(modality, groups) {
  const fields = FIELDS[modality];
  if (!fields || !Array.isArray(groups)) return null;
  const readings = {};
  for (const group of groups) {
    if (group == null) continue;
    if (typeof group !== 'object' || Array.isArray(group)) return null;
    for (const [key, value] of Object.entries(group)) {
      if (!Object.hasOwn(fields, key) || Object.hasOwn(readings, key)) return null;
      if (value == null) continue;
      const [min, max, integer] = fields[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return null;
      readings[key] = value;
    }
  }
  return Object.keys(readings).length ? readings : null;
}

export function safeFallback() {
  return {
    headline: 'Your recording is ready',
    interpretation: 'These experimental readings describe this recording and are not a medical assessment.',
    actions: [{ title: 'Try again when you are ready', detail: 'A quiet setting and a steady phone can help make recordings easier to compare.' }],
    source: 'fallback',
  };
}

export async function getCodexReport(env, modality, readings, fetchImpl = fetch) {
  if (!env.CODEX_ANALYTICS_URL || !env.CODEX_ACCESS_TOKEN) return safeFallback();
  try {
    const url = new URL(env.CODEX_ANALYTICS_URL);
    if (url.protocol !== 'https:') return safeFallback();
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.CODEX_ACCESS_TOKEN}` },
      body: JSON.stringify({ modality, readings }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return safeFallback();
    const report = await response.json();
    if (report?.source !== 'codex' || typeof report.headline !== 'string' || typeof report.interpretation !== 'string' || !Array.isArray(report.actions)) return safeFallback();
    return report;
  } catch {
    return safeFallback();
  }
}
