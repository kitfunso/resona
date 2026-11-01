import { json } from '../_lib/http.js';
import { getAuth } from '../_lib/session.js';
import { loadCurrentUser, insertCheckIn } from '../_lib/db.js';
import { pickReadings, getCodexReport, readAnalysisBody } from '../_lib/demo-analysis.js';

export async function onRequestPost(context) {
  const { env } = context;
  const auth = await getAuth(context);
  if (!auth) return json({ error: 'not authenticated' }, 401);
  const user = await loadCurrentUser(env, auth.userId);
  if (!user) return json({ error: 'user not found' }, 404);

  const body = await readAnalysisBody(context.request);
  const readings = pickReadings('breath', [body?.features]);
  if (!readings) return json({ error: 'invalid readings' }, 400);
  const personalReport = await getCodexReport(env, 'breath', readings);

  if (personalReport.source === 'codex') {
    try {
      await insertCheckIn(env, {
        userId: auth.userId,
        orgId: user.org_id,
        kind: 'breath',
        payload: { features: readings, personalReport },
      });
    } catch (err) {
      console.error('[analyze-blow] persist failed:', err.message);
      return json({ error: 'could not save report' }, 503);
    }
  }

  return json({ valid: true, personalReport });
}
