// Tiny HTTP helpers shared by the Pages Functions.

export function json(obj, status = 200, extraHeaders = {}) {
  // no-store: these are dynamic, per-session responses (health flags, the
  // current user, check-in history). The Cloudflare edge must never cache them
  // — a stale /health would hide the guest button and break the demo.
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return part.slice(idx + 1).trim();
  }
  return null;
}
