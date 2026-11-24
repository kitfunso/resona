import { json } from '../../_lib/http.js';

export function onRequestPost() {
  return json(
    { error: 'email sign-in is not available in this demo; use “Try it now, no sign-in”' },
    503,
  );
}
