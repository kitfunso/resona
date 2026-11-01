import { json } from '../_lib/http.js';
import { getAuth } from '../_lib/session.js';
import { loadCurrentUser, insertCheckIn } from '../_lib/db.js';
import { pickReadings, getCodexReport, readAnalysisBody } from '../_lib/demo-analysis.js';

// POST /api/analyze-heart — heart screen (camera rPPG result in the body).
export async function onRequestPost(context) {
  const { env } = context;
  const auth = await getAuth(context);
  if (!auth) return json({ error: 'not authenticated' }, 401);
  const user = await loadCurrentUser(env, auth.userId);
  if (!user) return json({ error: 'user not found' }, 404);

  const body = await readAnalysisBody(context.request);
  const readings = pickReadings('heart', [body?.heart]);
  if (!readings) return json({ error: 'invalid readings' }, 400);
  const report = await getCodexReport(env, 'heart', readings);

  if (report.source === 'codex') {
    try {
      await insertCheckIn(env, {
        userId: auth.userId,
        orgId: user.org_id,
        kind: 'heart',
        payload: { readings, heartReport: report },
      });
    } catch (err) {
      console.error('[analyze-heart] persist failed:', err.message);
      return json({ error: 'could not save report' }, 503);
    }
  }

  return json({ ok: true, report });
}
