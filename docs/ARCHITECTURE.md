# Architecture Notes

Detail moved out of source comments during comment cleanup passes. Source
keeps a short pointer; the full reasoning lives here.

## 2026-08-30 — Comment cleanup: preserved rationale

### server/aggregates.js — privacy boundary (UK GDPR Art 9)

This module owns every cross-employee read. Only `suppress()` can return a
count, so no query path can leak a raw small-group number.

- `MIN_GROUP = 5`: counts below this become the `SUPPRESSED` sentinel.
  Changing this value is a DPIA-affecting change.
- Bucket bands (`BANDS`) are frozen module constants with no override
  argument. A runtime band parameter would let a caller request
  fine-grained slices that triangulate individuals across the threshold.
- Three suppression layers: whole-response, per-bucket count, per-field
  scalar (`orgParticipation.active`).
- All queries are org-scoped from `req.currentUser.org_id` (route layer),
  never from request input. Team-scoped queries additionally filter
  `team_memberships` on `(team_id, org_id)` together — the SELECT-side
  mirror of Phase A's INSERT-side composite-FK protection, so filtering
  on `team_id` alone can't leak across orgs.
- `SUPPRESSED = {suppressed: true, reason: 'min-group'}`: the `suppressed`
  key is the only discriminant the UI branches on. It never appears on a
  non-suppressed response, so a missing key always means "not suppressed."
  It can appear at three nesting levels: top-level, a bucket count, or a
  scalar field.
- Bucket band conventions: `heart` uses the clinical resting-rate bands;
  `breath` uses clinical FEV1-percent-predicted bands; `motion` buckets on
  the analyzer's own `tremor.classification` categorical (see
  `server/index.js` `neuroReportFallback`) with unknown values going to
  `'unknown'` so the bucket set is always total.
- `orgParticipation`: `total` is the org's member count (not time-windowed).
  If `total < MIN_GROUP` the whole response is suppressed (org too small to
  show at all). If `total >= MIN_GROUP` but `active < MIN_GROUP`, only
  `active` is suppressed — `total` alone doesn't identify anyone, but the
  active subset would re-identify the few people who checked in.
- `modalityDistribution`: k-anonymity is over people, not rows. Every count
  (the gate `n` and each bucket) is `COUNT(DISTINCT user_id)`, and `n` is
  computed once in the CTE so a user who spans buckets is counted once —
  summing per-bucket distinct counts would over-count and under-suppress.
  A bucket count of exactly 0 stays 0 (nobody to identify); counts in
  `[1, MIN_GROUP-1]` are replaced with the sentinel; the label itself
  always stays visible.

### client/src/audio/regression.js — demo-grade spirometry estimator

Not clinical-grade. Maps timing/amplitude features from the acoustic blow
to a fraction of Hankinson-predicted FEV1/FVC/PEF, targeting: weak effort
40-70%, typical 85-115%, strong 110-130% of predicted.

- Duration is the primary driver, not amplitude, because 11 calibration
  blows on iOS Safari showed peak/RMS varying 3x between attempts at the
  same stated effort (phone-to-mouth distance dominates gain). `activeSec20`
  (fraction of the blow above 20% of its own peak) is a within-blow ratio,
  so it is invariant to distance, gain, and ambient noise.
- Score mapping: each second of sustained exhale (`activeSec05`) is 0.5
  score units, about 15% of predicted. `NORMAL_SUSTAIN_SEC = 4.5` is score 0
  (100% predicted); `SEC_PER_SCORE_UNIT = 2.0`.
- The active-time threshold is 5%, not 10-20%, because turbulent-flow mic
  noise scales with the square of airflow. As the lungs empty, true flow
  drops linearly but the recorded envelope drops quadratically, so a blow
  that is genuinely still flowing at 2-3s already reads under a 10% peak
  threshold. 5% stays above typical mic noise floor while capturing the
  full taper.
- Evidence against using amplitude directly: same user, both "max effort",
  attempt 6 (`peakEnv=2.06, rmsEnergy=0.89`) vs attempt 11
  (`peakEnv=0.70, rmsEnergy=0.35`) — a 3x swing from phone position alone.
- Per-metric bias (`perMetricBias`) nudges each of FEV1/PEF/FVC by up to
  +/-4-6% from timing, so the three percentages diverge like real spirometry
  instead of moving in lockstep: FEV1 tracks how fast peak flow arrived
  (ideal peak <=0.15s in, `z=+1`; late >=0.80s, `z=-1`, ATS-flag territory),
  PEF is the same driver but more sensitive, and FVC tracks how much of the
  blow lived in the 20%->5% taper (longer taper means fuller exhale).

### server/middleware-auth.js — `requireOrgAdmin` contract

Must be composed AFTER `requireAuth` (`app.get('/x', requireAuth,
requireOrgAdmin, handler)`). It only does the role check; org_id
tenant-scoping is each handler's own responsibility.

On success it attaches `req.currentUser` pinned to the least-data shape
`{id, role, org_id, org_slug, org_name}`. The special-category fields
`loadCurrentUser` returns (`dob`, `height_cm`, `sex`, `ethnicity`, `email`,
`name`) are deliberately not propagated, per UK GDPR Art 5(1)(c) data
minimisation.

Failure modes:
- `req.auth` missing (mounted without `requireAuth`) -> 401 `not authenticated`
- DB error loading the user -> `next(err)` (platform error path)
- user row deleted after a session was minted (stale 30d session) -> 401
  `session no longer valid`
- `role !== 'admin'` -> 403 `forbidden`, plus a `console.info('[admin-deny] ...')`
  audit line, the Art 5(2) accountability surface for this special-category
  read path. It mirrors the `[role-grant] ...` line Phase A logs on the
  grant side.

### server/index.js — admin/erasure route rationale

`DELETE /api/admin/users/:id` (right-to-erasure, UK GDPR Art 17): session-RBAC
only (`requireOrgAdmin`), never the global `ADMIN_TOKEN` — org comes from
`req.currentUser.org_id`, never from input, so an admin can only erase users
in their own tenant. Bound to `(id, org_id)`; the `ON DELETE CASCADE` chain
(`check_ins`, `team_memberships`, `role_grants`) purges everything in one
statement, and a `[user-erase]` line is the Art 5(2) accountability trail.
Residual scope NOT covered (documented for the DPA): server access logs, LLM
trace files, and any external sub-processor copies.

`GET /api/admin/teams/:id/overview`: the 404 is byte-identical whether the id
is malformed, well-formed-but-missing, or well-formed-but-another-org's —
distinguishable status codes would let an org-A admin enumerate team UUIDs.
Timing-channel equalisation is out of scope at this threat level.

`GET /api/admin/teams`: a team's `member_count` is suppressed below
`MIN_GROUP` the same way `suppress()` does elsewhere — count doubles as both
the value and the threshold gate, since the count itself is the identifying
signal for a small team.

`GET /api/admin/overview` / `/api/admin/teams/:id/overview`: `adminLimiter`'s
20 req/min cap is a differential-probe mitigation — without it an admin could
sweep `?days=1..365` to triangulate per-day check-in deltas and defeat
`MIN_GROUP` suppression. Team-scope intentionally has no separate
active/total participation pair; that split is itself identifying for a
small team, so only the distribution is exposed.

### server/reports.js — ATS 2019 flag thresholds

Feasible subset of ATS 2019 on phone audio, not the full standard:
- PEF timing: ATS wants peak within 120ms of exhalation onset, but the
  envelope is low-pass filtered at 20Hz (50ms time constant) so sub-120ms
  isn't reliably resolvable. Use 500ms as the "clearly not a sharp burst"
  threshold instead — enough to rule out speech and talking.
- Duration: ATS wants forced exhalation >= 6s. Most phone blows end early,
  so flag below 3.5s as "short" rather than hard-rejecting; 3-6s is still
  usable for screening.

### shared/reference-equations.js — Hankinson NHANES III equations

Source: Hankinson JL, Odencrantz JR, Fedan KB. "Spirometric reference values
from a sample of the general U.S. population." Am J Respir Crit Care Med.
1999;159(1):179-187. Coefficients are the published adult (age>=20) values,
cross-verified against the rspiro R package source
(github.com/thlytras/rspiro, data-raw/NHtb45.csv, MIT-licensed).

Equation form: `value = b0 + b1*age + b2*age^2 + b3*height^2` (age in years,
height in cm, value in litres, L/s for PEF).

NHANES III published 3 ethnic groups (Caucasian, African American, Mexican
American) and does not include South or East Asian cohorts. Non-Hankinson
ethnicities (south_asian, east_asian, black_non_aa, mixed_or_other) route to
Caucasian coefficients, with the limitation disclosed in the generated GP
letter.

### client/src/imu/tremor.js — tremor classification bands

Stillness test (phone held at arm's length ~10s): acceleration magnitude
minus gravity, detrended, FFT'd, power measured in four clinically-named
bands. Screening only — the output is NOT diagnostic.

- 0.5-4 Hz: not tremor (voluntary movement / postural drift)
- 4-6 Hz: Parkinsonian tremor (rest tremor)
- 6-12 Hz: essential tremor / kinetic tremor
- 12-20 Hz: physiological tremor (normal muscle activity)

Classification heuristic: default 'physiological' unless one band dominates
the other two by at least 2x (Parkinsonian) or 1.6x (essential-like), with a
guard band around the clinical boundaries so a healthy user's arm drift at
exactly 6 Hz isn't misflagged. If low-frequency drift (<3 Hz) outpowers all
three tremor bands, the person was swaying their arm, not tremoring —
call it physiological too.

### client/src/audio/features.js — SpiroSmart-based feature extraction

Based on SpiroSmart (Goel et al., UbiComp 2012): rectified+low-pass envelope
(approximates |Hilbert transform|), peak envelope amplitude, envelope decay
time constant (exponential fit on the decay tail after the peak), RMS
energy, and first formant frequency (FFT peak-pick on the loud segment).

### client/src/video/pos.js — POS rPPG algorithm

Implements Wang et al., IEEE TBE 2017 ("Plane-Orthogonal-to-Skin"). Input
is per-frame mean R/G/B for one ROI at a uniform fps; output is a 1D pulse
signal downstream code FFTs for heart rate. Each channel is normalised by
its own rolling 1.6s mean (kills lighting drift), then projected with the
paper's matrix P onto two skin-orthogonal axes (`X = G_n - B_n`,
`Y = -2*R_n + G_n + B_n`) and combined as `X + alpha*Y` with
`alpha = std(X)/std(Y)` per window; windows overlap by half and are summed
(overlap-add).
