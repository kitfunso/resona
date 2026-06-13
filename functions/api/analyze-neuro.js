import { json } from '../_lib/http.js';
import { getAuth } from '../_lib/session.js';
import { loadCurrentUser, insertCheckIn } from '../_lib/db.js';
import { buildDemographics, neuroReportFallback, scrubReport } from '../_lib/reports.js';

// POST /api/analyze-neuro — motion screen (IMU tremor + gait in the body).
export async function onRequestPost(context) {
  const { env } = context;
  const auth = await getAuth(context);
  if (!auth) return json({ error: 'not authenticated' }, 401);
  const user = await loadCurrentUser(env, auth.userId);
  if (!user) return json({ error: 'user not found' }, 404);

  const demographics = buildDemographics(user);
  if (!demographics.ageYears || !demographics.sex) {
    return json({ error: 'profile incomplete; PATCH /api/me first' }, 400);
  }

  const body = await context.request.json().catch(() => ({}));
  const { tremor, gait } = body || {};
  if (!tremor && !gait) return json({ error: 'need at least one of tremor or gait' }, 400);

  const report = neuroReportFallback({ tremor, gait });
  report.source = 'fallback';
  scrubReport(report);

  try {
    await insertCheckIn(env, {
      userId: auth.userId,
      orgId: user.org_id,
      kind: 'motion',
      payload: { tremor, gait, neuroReport: report },
    });
  } catch (err) {
    console.error('[analyze-neuro] persist failed:', err.message);
  }

  return json({ ok: true, report });
}
