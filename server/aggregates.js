// Privacy boundary (UK GDPR Art 9, employer-as-controller):
//
//   - MIN_GROUP = 5 is the threshold below which any count is replaced
//     by the SUPPRESSED sentinel. Bumping it is a DPIA-affecting change.
import { pool } from './db.js';

export const MIN_GROUP = 5;

export const SUPPRESSED = Object.freeze({ suppressed: true, reason: 'min-group' });

export const BANDS = Object.freeze({
  heart: Object.freeze([
    Object.freeze({ label: 'low',      min: 0,   max: 60  }),
    Object.freeze({ label: 'normal',   min: 60,  max: 100 }),
    Object.freeze({ label: 'elevated', min: 100, max: Number.POSITIVE_INFINITY }),
  ]),
  breath: Object.freeze([
    Object.freeze({ label: 'below_predicted', min: 0,   max: 80  }),
    Object.freeze({ label: 'predicted',       min: 80,  max: 100 }),
    Object.freeze({ label: 'above_predicted', min: 100, max: Number.POSITIVE_INFINITY }),
  ]),
  motion: Object.freeze([
    Object.freeze({ label: 'parkinsonian_like' }),
    Object.freeze({ label: 'essential_like' }),
    Object.freeze({ label: 'physiological' }),
    Object.freeze({ label: 'unknown' }),
  ]),
});

export function suppress(value, n) {
  return n >= MIN_GROUP ? value : SUPPRESSED;
}

export async function orgParticipation(orgId, sinceDays) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM users
          WHERE org_id = $1) AS total,
       (SELECT COUNT(DISTINCT user_id)::int FROM check_ins
          WHERE org_id = $1
            AND created_at >= now() - ($2::int * interval '1 day')) AS active`,
    [orgId, sinceDays],
  );
  const { total, active } = rows[0];

  if (total < MIN_GROUP) return SUPPRESSED;
  return { active: suppress(active, active), total };
}

export async function modalityDistribution(orgId, kind, sinceDays, opts = {}) {
  if (!BANDS[kind]) {
    throw new Error(`modalityDistribution: unknown kind '${kind}'`);
  }
  const { teamId } = opts;
  const bucketCase = buildBucketCase(kind);

  const params = [orgId, kind, sinceDays];
  let teamScope = '';
  if (teamId !== undefined && teamId !== null) {
    params.push(teamId);
    teamScope = `
      AND user_id IN (
        SELECT user_id FROM team_memberships
         WHERE team_id = $4 AND org_id = $1
      )`;
  }
  const sql = `
    WITH filtered AS (
      SELECT user_id, ${bucketCase} AS bucket
      FROM check_ins
      WHERE org_id = $1
        AND kind = $2
        AND created_at >= now() - ($3::int * interval '1 day')${teamScope}
    )
    SELECT
      bucket,
      COUNT(DISTINCT user_id)::int AS count,
      (SELECT COUNT(DISTINCT user_id)::int FROM filtered) AS n
    FROM filtered
    GROUP BY bucket`;

  const { rows } = await pool.query(sql, params);

  const n = rows.length > 0 ? rows[0].n : 0;
  if (n < MIN_GROUP) return SUPPRESSED;

  const counts = new Map(rows.map((r) => [r.bucket, r.count]));
  const buckets = BANDS[kind].map((band) => ({
    label: band.label,
    count: counts.get(band.label) ?? 0,
  }));

  const suppressed = buckets.map((b) =>
    b.count > 0 && b.count < MIN_GROUP
      ? { label: b.label, count: SUPPRESSED }
      : b,
  );
  return { buckets: suppressed, n };
}

function buildBucketCase(kind) {
  if (kind === 'motion') {
    const known = BANDS.motion.filter((b) => b.label !== 'unknown').map((b) => b.label);
    const whens = known
      .map(
        (label) =>
          `WHEN payload->'tremor'->>'classification' = '${label}' THEN '${label}'`,
      )
      .join('\n        ');
    return `CASE
        ${whens}
        ELSE 'unknown'
      END`;
  }
  let path;
  if (kind === 'heart')  path = `payload->'heart'->>'hrBpm'`;
  if (kind === 'breath') path = `payload->'estimate'->'percentPredicted'->>'fev1'`;
  if (!path) throw new Error(`buildBucketCase: no path for kind '${kind}'`);

  const whens = BANDS[kind]
    .map((band) => {
      if (band.max === Number.POSITIVE_INFINITY) {
        return `WHEN (${path})::numeric >= ${band.min} THEN '${band.label}'`;
      }
      return `WHEN (${path})::numeric >= ${band.min} AND (${path})::numeric < ${band.max} THEN '${band.label}'`;
    })
    .join('\n        ');
  return `CASE
        ${whens}
        ELSE 'unknown'
      END`;
}
