import { json } from '../../_lib/http.js';

// POST /api/auth/verify — counterpart to request.js. No OTP issued in the demo,
// so nothing can be verified. Guest mode is the supported path.
export function onRequestPost() {
  return json(
    { error: 'email sign-in is not available in this demo; use “Try it now, no sign-in”' },
    503,
  );
}
