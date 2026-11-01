import { json } from './_lib/http.js';

// GET /health — the client's fetchHealth() reads `demo` to decide whether to
// show the "Try it now, no sign-in" guest button.
export function onRequestGet(context) {
  return json({
    ok: true,
    product: 'Resona',
    modules: ['Breath', 'Neuro', 'Heart'],
    tagline: 'Every body has a rhythm.',
    db: 'd1',
    demo: context.env.DEMO_MODE === 'true' && /^[A-Za-z0-9_-]{32,128}$/.test(context.env.DEMO_ACCESS_TOKEN || '')
      && typeof context.env.SESSION_SECRET === 'string' && context.env.SESSION_SECRET.length >= 32,
    codexAnalytics: typeof context.env.CODEX_ANALYTICS_URL === 'string'
      && /^https:\/\//.test(context.env.CODEX_ANALYTICS_URL)
      && /^[A-Za-z0-9_-]{32,128}$/.test(context.env.CODEX_ACCESS_TOKEN || ''),
    uptime_s: 0,
  });
}
