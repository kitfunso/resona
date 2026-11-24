import { json } from './_lib/http.js';

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
