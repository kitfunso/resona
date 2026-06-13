import { json } from '../_lib/http.js';
import { getAuth } from '../_lib/session.js';
import { loadCurrentUser, insertCheckIn } from '../_lib/db.js';
import { buildDemographics, atsFlags, classifierFallback, personalReportFallback } from '../_lib/reports.js';

// POST /api/analyze-blow — breath screen. Demographics are derived from the DB
// user, never from the request body. The LLM upstream is unreachable on the
// edge, so the deterministic fallback report is used directly.
export async function onRequestPost(context) {
  const { env } = context;
  const auth = await getAuth(context);
  if (!auth) return json({ error: 'not authenticated' }, 401);
  const user = await loadCurrentUser(env, auth.userId);
  if (!user) return json({ error: 'user not found' }, 404);

  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex || !demographics.heightCm) {
    return json({ error: 'profile incomplete; PATCH /api/me first' }, 400);
  }

  const body = await context.request.json().catch(() => ({}));
  const { features, estimate } = body || {};
  if (!features || !estimate) return json({ error: 'missing features or estimate' }, 400);
  if (
    !Number.isFinite(estimate.fev1) ||
    !Number.isFinite(estimate.fvc) ||
    !Number.isFinite(estimate.pef) ||
    !Number.isFinite(estimate.effortScore) ||
    !estimate.percentPredicted ||
    !Number.isFinite(estimate.percentPredicted.fev1)
  ) {
    return json({ error: 'malformed estimate' }, 400);
  }

  const classification = classifierFallback({ features, estimate });
  if (!classification?.valid) {
    return json({
      valid: false,
      reason: classification?.reason || 'unknown',
      coachingMessage: classification?.coaching_message || 'That did not look like a valid blow. Try again.',
    });
  }

  const flags = atsFlags(features);
  const personalReport = personalReportFallback({ estimate });
  personalReport.source = 'fallback';

  try {
    await insertCheckIn(env, {
      userId: auth.userId,
      orgId: user.org_id,
      kind: 'breath',
      payload: { features, estimate, atsFlags: flags, personalReport },
    });
  } catch (err) {
    console.error('[analyze-blow] persist failed:', err.message);
  }

  return json({ valid: true, classification, atsFlags: classification.atsFlags || [], personalReport });
}
