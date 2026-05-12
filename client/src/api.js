// Tiny fetch wrapper with 1 retry on network errors.
// The server-side endpoint handles GLM retries; this handles
// the client → server hop.

async function postJson(path, body, { retries = 1, timeoutMs = 35000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err.name === 'AbortError') {
        // timeout, retry if we have budget
        if (attempt < retries) continue;
        throw new Error('Analysis timed out. Try again.');
      }
      // Network-level errors: retry once
      if (attempt < retries && (err.message || '').toLowerCase().includes('fetch')) continue;
      throw err;
    }
  }
  throw lastErr ?? new Error('postJson failed');
}

// Stable per-device session id for leaderboard deduplication. Re-blows from
// the same phone update that device's best FVC instead of inflating the team
// total. Generated once, persisted via localStorage.
const SESSION_KEY = 'resona:sessionId';
function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ssn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
export function getSessionId() {
  if (typeof localStorage === 'undefined') return newSessionId();
  let id = null;
  try {
    id = localStorage.getItem(SESSION_KEY);
  } catch {}
  if (!id) {
    id = newSessionId();
    try { localStorage.setItem(SESSION_KEY, id); } catch {}
  }
  return id;
}

export function analyzeBlow({ features, estimate, demographics }) {
  return postJson('/api/analyze-blow', {
    features,
    estimate,
    demographics,
    sessionId: getSessionId(),
  });
}

export function analyzeHeart({ heart, demographics }) {
  return postJson('/api/analyze-heart', {
    heart,
    demographics,
    sessionId: getSessionId(),
  });
}
