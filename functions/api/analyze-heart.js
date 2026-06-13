import { json } from '../_lib/http.js';
import { getAuth } from '../_lib/session.js';
import { loadCurrentUser, insertCheckIn } from '../_lib/db.js';
import { buildDemographics, heartReportFallback, scrubReport } from '../_lib/reports.js';

// POST /api/analyze-heart — heart screen (camera rPPG result in the body).
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
  const { heart } = body || {};
  if (!heart || typeof heart !== 'object') return json({ error: 'missing heart payload' }, 400);
  if (!Number.isFinite(heart.hrBpm)) return json({ error: 'heart.hrBpm must be a finite number' }, 400);

  if (heart.quality?.grade === 'poor') {
    return json({
      ok: false,
      coaching: {
        message:
          'We could not read a clean pulse from your camera. Move into brighter, even light, hold still with your face centred in the oval, and try again.',
      },
    });
  }

  const report = heartReportFallback({ heart });
  report.source = 'fallback';
  scrubReport(report);

  try {
    await insertCheckIn(env, {
      userId: auth.userId,
      orgId: user.org_id,
      kind: 'heart',
      payload: { heart, heartReport: report },
    });
  } catch (err) {
    console.error('[analyze-heart] persist failed:', err.message);
  }

  return json({ ok: true, report });
}
