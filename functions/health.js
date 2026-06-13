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
    demo: context.env.DEMO_MODE === 'true',
    uptime_s: 0,
  });
}
