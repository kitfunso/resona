// Paid requests are not retried because a lost response can still be billed.
async function postJson(path, body, { timeoutMs = 35000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Analysis timed out. Try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function numbers(source, keys) {
  if (!source) return null;
  return Object.fromEntries(keys.filter((key) => Number.isFinite(source[key])).map((key) => [key, source[key]]));
}

export function analyzeBlow({ features }) {
  return postJson('/api/analyze-blow', { features: numbers(features, ['rmsEnergy', 'activeSec10', 'peakEnv']) });
}

export function analyzeHeart({ heart }) {
  return postJson('/api/analyze-heart', { heart: numbers(heart, ['hrBpm', 'beatCount', 'durationSec']) });
}

export function analyzeNeuro({ tremor, gait }) {
  return postJson('/api/analyze-neuro', {
    tremor: numbers(tremor, ['dominantFrequencyHz', 'sampleRate']),
    gait: numbers(gait, ['stepsDetected', 'cadence', 'stridesCv', 'symmetryIndex']),
  });
}

// GET helper. Throws an Error tagged with `.kind` ('auth-expired' | 'network')
// so callers can branch on auth-vs-other failures without re-checking statuses.
async function getJson(path, { timeoutMs = 35000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, { credentials: 'include', signal: controller.signal });
  } catch {
    clearTimeout(timer);
    const e = new Error('network request failed');
    e.kind = 'network';
    throw e;
  }
  clearTimeout(timer);
  if (res.status === 401) {
    const e = new Error('not authenticated');
    e.kind = 'auth-expired';
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.kind = 'network';
    throw e;
  }
  return res.json();
}

export function getCheckIns(limit = 50) {
  return getJson(`/api/me/check-ins?limit=${encodeURIComponent(limit)}`);
}
