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

export function analyzeBlow({ features, estimate, demographics }) {
  return postJson('/api/analyze-blow', { features, estimate, demographics });
}
