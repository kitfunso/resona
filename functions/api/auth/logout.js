import { json } from '../../_lib/http.js';
import { clearCookieHeader } from '../../_lib/session.js';

export function onRequestPost() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader() });
}
