async function postJson(path, body, { retries = 1, timeoutMs = 35000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
        if (attempt < retries) continue;
        throw new Error('Analysis timed out. Try again.');
      }
      if (attempt < retries && (err.message || '').toLowerCase().includes('fetch')) continue;
      throw err;
    }
  }
  throw lastErr ?? new Error('postJson failed');
}

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

export function analyzeNeuro({ tremor, gait, demographics }) {
  return postJson('/api/analyze-neuro', { tremor, gait, demographics });
}

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
