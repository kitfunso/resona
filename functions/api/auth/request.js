import { json } from '../../_lib/http.js';

// POST /api/auth/request — email-OTP sign-in needs a hosted email provider,
// which this demo deployment does not run. Guest mode is the supported path.
// Returns a clear 503 so the email form fails fast instead of hanging.
export function onRequestPost() {
  return json(
    { error: 'email sign-in is not available in this demo; use “Try it now, no sign-in”' },
    503,
  );
}
