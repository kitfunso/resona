// server/aggregates.js
//
// Cross-employee aggregate reads for the admin dashboard (Phase B Task B2).
// This module owns every query that reads across employees in an org. The
// ONLY way it returns a count is through suppress(), which enforces the
// minimum-group threshold below.
//
// Privacy boundary (UK GDPR Art 9, employer-as-controller):
//
//   - MIN_GROUP = 5 is the threshold below which any count is replaced
//     by the SUPPRESSED sentinel. Bumping it is a DPIA-affecting change.
//   - Bucket bands per kind are frozen module-level constants. The
//     functions in this module do NOT accept band-override arguments;
//     a runtime band parameter would let a probe request fine-grained
//     slices that triangulate individuals across the threshold.
//   - Three suppression layers: whole-response, individual bucket count,
//     individual scalar field (orgParticipation.active).
//   - All queries are org-scoped via the orgId argument (sourced
//     exclusively from req.currentUser.org_id at the route layer; never
//     from request input). Team-scoped queries additionally filter
//     team_memberships on (team_id, org_id) - the SELECT-side mirror
//     of Phase A's INSERT-side composite-FK protection.

import { pool } from './db.js';

export const MIN_GROUP = 5;

// SUPPRESSED is the discriminant the consumer (Phase C UI) branches on.
// The key `suppressed: true` is the discriminant. A non-suppressed
// response NEVER carries this key, so a missing key is unambiguously
// "not suppressed". The sentinel may appear at three nesting levels:
// top-level response, individual bucket count, individual scalar field.
export const SUPPRESSED = Object.freeze({ suppressed: true, reason: 'min-group' });

// Bucket bands per kind, frozen so neither this module nor any consumer
// can mutate them at runtime. The labels are stable strings the UI can
// switch on.
//
// heart: clinical resting-rate convention (half-open intervals).
// breath: clinical FEV1 percent-predicted (half-open intervals).
// motion: bucket on the analyzer's own tremor.classification 3-value
//   categorical (see server/index.js neuroReportFallback for the source
//   of these strings). Any classification not in the known set falls
//   into 'unknown' so the bucket set is total.
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

// suppress(value, n): identity unless n is below MIN_GROUP. Used at
// three layers: top-level response, individual bucket count, individual
// scalar field.
export function suppress(value, n) {
  return n >= MIN_GROUP ? value : SUPPRESSED;
}

// orgParticipation(orgId, sinceDays) -> {active, total}
//
// total = the org's distinct member count (window-INDEPENDENT; the org
//   itself isn't time-bounded).
// active = distinct employees with >= 1 check-in in [now() - sinceDays, now()].
//
// Suppression rules:
//   - total < MIN_GROUP -> whole response = SUPPRESSED (org too small to show).
//   - total >= MIN_GROUP but active < MIN_GROUP -> {active: SUPPRESSED, total: N}
//     (total is non-identifying but the active set re-identifies the few
//     employees who checked in).
//   - active >= MIN_GROUP -> {active: N, total: M} (both visible).
export async function orgParticipation(orgId, sinceDays) {
  // Single query: separate scalar subqueries for total and active so we
  // hit the index on each. total uses only org_id; active adds the window.
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

// modalityDistribution(orgId, kind, sinceDays, opts) -> {buckets, n} | SUPPRESSED
//
// opts.teamId: when present, scope the query to users in that team
//   (composite-key team_memberships filter on (team_id, org_id) is the
//   SELECT-side mirror of Phase A's INSERT-side composite-FK guard).
//
// Dual-layer suppression:
//   - If the total count n < MIN_GROUP -> whole response = SUPPRESSED.
//   - Otherwise return {buckets, n} where each bucket whose count is in
//     [1, MIN_GROUP-1] is replaced by {label, count: SUPPRESSED}. The
//     label stays visible (it's not identifying); the count is the
//     identifying field. A bucket with count 0 stays as count 0 (zero
//     is non-identifying because no-one is in it).
//
// Signature is fixed: no band-override argument. Bands live only in
// the frozen BANDS export.
export async function modalityDistribution(orgId, kind, sinceDays, opts = {}) {
  if (!BANDS[kind]) {
    throw new Error(`modalityDistribution: unknown kind '${kind}'`);
  }
  const { teamId } = opts;
  // Build the kind-specific CASE expression. Pinned in code, NOT derived
  // from any request input - the only thing the caller picks is `kind`.
  const bucketCase = buildBucketCase(kind);

  // Single GROUP BY: one query, one pass. n is derived from SUM in JS.
  const params = [orgId, kind, sinceDays];
  let sql = `
    SELECT
      ${bucketCase} AS bucket,
      COUNT(*)::int AS count
    FROM check_ins
    WHERE org_id = $1
      AND kind = $2
      AND created_at >= now() - ($3::int * interval '1 day')
  `;
  if (teamId !== undefined && teamId !== null) {
    params.push(teamId);
    // Composite-key team scope: ($4, $1) matches the (team_id, org_id)
    // pair on team_memberships. Filtering on team_id alone would
    // re-introduce the cross-org leak Phase A's composite FK prevents
    // at INSERT time.
    sql += `
      AND user_id IN (
        SELECT user_id FROM team_memberships
         WHERE team_id = $4 AND org_id = $1
      )
    `;
  }
  sql += ` GROUP BY bucket`;

  const { rows } = await pool.query(sql, params);

  // Build a stable bucket set: every band label appears in the response
  // (with count 0 if no rows landed there). Buckets land deterministically
  // because the SQL CASE expression uses half-open intervals.
  const counts = new Map(rows.map((r) => [r.bucket, r.count]));
  const buckets = BANDS[kind].map((band) => ({
    label: band.label,
    count: counts.get(band.label) ?? 0,
  }));

  const n = buckets.reduce((acc, b) => acc + b.count, 0);
  if (n < MIN_GROUP) return SUPPRESSED;

  // Per-bucket suppression: replace count with sentinel if in [1, MIN_GROUP-1].
  // Count 0 stays as 0 (no-one to identify); count >= MIN_GROUP stays as is.
  const suppressed = buckets.map((b) =>
    b.count > 0 && b.count < MIN_GROUP
      ? { label: b.label, count: SUPPRESSED }
      : b,
  );
  return { buckets: suppressed, n };
}

// Build a SQL CASE expression for the kind's bucket bands. NOT derived
// from any request input - kind is the only caller-selected value, and
// it's validated against BANDS above.
function buildBucketCase(kind) {
  if (kind === 'motion') {
    // motion: bucket on the analyzer's own categorical classification.
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
  // Numeric kinds: bucket on a JSONB numeric path.
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
