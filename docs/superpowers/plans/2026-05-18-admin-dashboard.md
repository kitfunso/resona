# Plan: Admin / HR aggregate dashboard

**Status:** Draft, not yet reviewed.
**Date:** 2026-05-18
**Depends on:** `2026-05-13-corporate-foundations.md` (complete — Postgres, auth,
orgs, `check_ins`).

## Why

After the corporate-foundations work, employees can sign in, complete check-ins,
and the results persist to `check_ins`. There is still nothing for the *buyer* —
the employer. This plan adds the admin-facing surface: an org admin signs in and
sees how their workforce is doing in aggregate.

## The hard constraint: this is employee health data

The buyer is the employer. The data subjects are its employees. An employer that
can see an individual employee's lung function or heart-rate variability is a
product that no employee should trust and that creates real legal exposure for
the employer. So the central design rule of this plan:

**The admin dashboard shows aggregates only, and never an aggregate small enough
to re-identify a person.**

## Open product decisions (assumptions made here — change before building)

These were decided conservatively in this draft. They are the things to confirm
(an `/office-hours` pass is the right tool):

1. **Role model.** Assumed: a single `role` per user, `member` or `admin`, set
   per-org. An admin of org X sees org X aggregates only. No cross-org/superadmin
   role in this plan.
2. **Minimum aggregation group size.** Assumed: **N = 5**. Any metric computed
   over fewer than 5 distinct employees is suppressed and shown as "not enough
   data". This applies to the whole org and to every team breakdown.
3. **No individual drilldown — at all.** The dashboard has no path to a named
   employee's data. Admins cannot see who has or has not checked in by name.
   Participation is a count and a rate, never a list.
4. **Teams are optional.** Orgs may define teams; aggregates can be broken down
   by team, but each team breakdown is independently min-N suppressed.
5. **Metrics shown.** Assumed: participation rate over a period, and
   *distribution* summaries per modality (e.g. share of breath check-ins in
   normal vs. low predicted-value bands; median HRV band). Never raw values,
   never a leaderboard, never a ranking of people.
6. **Employee transparency.** Employees should be able to see that aggregate
   reporting exists and what it contains. Phase D gives the employee their own
   history view; the employee-facing disclosure copy is a content task, flagged
   but not built here.

## Phases

- **Phase A** — data model: `role` on users, `teams`, `team_memberships`.
- **Phase B** — aggregate read API: admin-gated, org-scoped, min-N suppressed.
- **Phase C** — the admin dashboard UI.
- **Phase D** — the employee's own check-in history view.

Each task lists files, steps, verification, and a commit. Tests use the existing
`node --test` setup; UI tasks verify via `npm run build` + a browser pass.

---

## Phase A: Data model

### Task A1: Add `role` to users + `teams` and `team_memberships`

**Files:**
- Create: `server/migrations/003_admin.sql`
- Create: `server/test-admin-schema.js`

- [ ] **Step 1: Write the failing test** (`server/test-admin-schema.js`) — assert,
  via `information_schema`, that: `users.role` exists with a
  `CHECK (role IN ('member','admin'))` and default `'member'`; `teams` exists
  with `id, org_id (FK orgs ON DELETE CASCADE), name, created_at`; and
  `team_memberships` exists with `(user_id, team_id)` unique, both FKs
  `ON DELETE CASCADE`.

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write `003_admin.sql`:**

```sql
ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('member', 'admin'));

CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX teams_org_idx ON teams (org_id);

CREATE TABLE team_memberships (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX team_memberships_team_idx ON team_memberships (team_id);
```

  The migration runner picks `003_admin.sql` up automatically on boot.

- [ ] **Step 4: Run the test, expect PASS.** Then `npm test`.

- [ ] **Step 5: Commit** — `feat: add role + teams schema`.

### Task A2: Admin endpoints for role + team management

**Files:**
- Modify: `server/index.js`

These extend the existing `ADMIN_TOKEN`-gated bootstrap surface (`/api/admin/*`)
so the founder can promote a user to `admin` and create teams. A self-service
org-admin UI for this is out of scope; the static token is enough to onboard.

- [ ] **Step 1:** Add, all chained behind `adminLimiter` + `requireAdmin`:
  - `POST /api/admin/users/:id/role` — body `{role}`, validates `role` against
    the allowlist, updates the user. 404 if the user does not exist.
  - `POST /api/admin/teams` — body `{orgSlug, name}`, creates a team in that org.
  - `POST /api/admin/teams/:id/members` — body `{userEmail}`, adds a user to a
    team; 409 on duplicate, 400 if the user's org does not match the team's org.

- [ ] **Step 2:** All queries parameterised; reuse the `23505` → 409 pattern.

- [ ] **Step 3: Smoke-test** each with `curl` + the admin token.

- [ ] **Step 4: Commit** — `feat: add admin role + team management endpoints`.

### Phase A revisions (2026-05-23, post-PR #8)

The Phase A above is the original draft. PR #8 shipped Phase A after a
plan-eng-critic review (run via `/dev-framework-rl` episode
`01KSA2C6YSMSFFDE0X37PZ3EK0`) surfaced one crit and four high issues in
the regulatory / privacy framing of the draft. The shipped implementation
folds those resolutions in. Phase B / C / D below are unchanged.

The authoritative reference for the as-built schema and endpoints is
`server/migrations/003_admin.sql` and the new admin handlers in
`server/index.js` on commit `073b2d9` (PR #8). The deltas vs the original
draft:

1. **Cross-org tenant isolation moved to the schema (was handler-only).**
   The original draft enforced cross-org safety on `team_memberships`
   only with a handler-level 400 response. Any code path that inserted
   directly (bulk import, admin script, future endpoint) would create
   cross-org membership rows and Phase B's team-scoped aggregate reads
   would leak one org's check-ins into another's dashboard. **Shipped:**
   `team_memberships` carries a denormalised `org_id` with composite FKs
   back to `users(id, org_id)` and `teams(id, org_id)`. Supporting
   `UNIQUE(id, org_id)` was added to both `users` and `teams` so the
   composite FK targets are valid. Cross-org rows are now unrepresentable
   at the SQL level. A regression test in `server/test-admin-endpoints.js`
   attempts a raw INSERT with mismatched orgs and asserts PG code
   `23503`.

2. **`role_grants` audit table added.** Promoting a user to `admin` is
   the single authority hop that unlocks Phase B's org-wide Article 9
   special-category reads. UK GDPR Art 5(2) accountability needs the
   trail in place by the time Phase B ships. The role-grant handler now
   writes the `UPDATE users SET role` and the `INSERT INTO role_grants`
   in one transaction with `console.info` audit logging. `granted_by` is
   CHECK-constrained to `'admin_token'` or `'session:%'` so Phase B's
   session-based grants slot in without schema change.

3. **`teams.name` constraints moved to the schema (was handler-only).**
   The original draft validated team-name shape only in the handler.
   **Shipped:** the schema CHECK enforces a deliberate ASCII-only
   allowlist (`^[A-Za-z0-9 .,&'\-]+$`, length 1..80) plus
   `UNIQUE(org_id, lower(name))` for case-insensitive within-org
   uniqueness. The ASCII restriction is a deliberate divergence from
   `/api/me`'s Unicode-letter name regex (personal names are Unicode;
   enterprise team names are ASCII labels), captured in the migration
   comment.

4. **`users.role` flows through `/api/me`.** The original draft did not
   say whether Phase B's session-based `requireOrgAdmin` middleware
   should read role from the JWT, from a separate SELECT, or from
   `loadCurrentUser`. **Shipped:** `loadCurrentUser` selects
   `users.role`, so the existing `/api/me` response payload carries it.
   Phase C's `AdminView` toggle (Task C1 Step 2) can branch on
   `user.role` without any extra request.

5. **UUID pre-validation on `:id` URL params.** A malformed `:id` on
   `POST /api/admin/users/:id/role` and `POST /api/admin/teams/:id/members`
   used to fall through to the DB and raise PG `22P02`
   (invalid_text_representation) which escaped as a generic 500. The
   shipped handlers pre-validate `:id` against a UUID regex and return a
   clean 400 `{ error: 'invalid id' }`. Surfaced by the
   independent-review-critic post-execute; regression tests added.

6. **A2 has `node --test` integration tests, not curl smoke-tests.** The
   original draft said "smoke-test with curl"; the project memory
   mandates `node --test` against a real PG. **Shipped:**
   `server/test-admin-endpoints.js` covers all three new endpoints
   (ADMIN_TOKEN gating, role allowlist, 404 on missing user, 409 on
   duplicate team name, 400 on cross-org add, the schema-level cross-org
   INSERT regression, the 22P02 -> 400 regressions, atomic role-grant +
   audit-row write, no-op-when-unchanged).

7. **23P01 explicitly NOT caught in the cross-org error branch.** The
   original draft conflated `23503` (FK rejection, the cross-org signal)
   with `23P01` (transaction deadlock / serialisation failure). The
   shipped handler maps only `23503` to 400, lets `23P01` bubble to a
   500 (it is not a cross-org indicator).

Known low-severity items left as documented follow-ups: the schema-cross
regression test calls `seed('schema-cross')` twice in a cosmetic
duplicate; the `granted_by` CHECK accepts a zero-length `session:`
prefix; the role no-op path uses a non-transactional SELECT with a
low-probability TOCTOU race for a bootstrap surface.

The `/dev-framework-rl` learn step from this episode added two
skill-level updates (verify-stage real-test-DB convention; plan-stage
existing-draft-doc briefing) and one probationary hippo memory
(multi-tenant join tables -> composite FKs) — none of which change the
plan content here, but they should reduce the chance of the same crit
slipping past a draft review next time.

---

## Phase B: Aggregate read API

### Task B1: `requireAdmin` session middleware

**Files:**
- Modify: `server/middleware-auth.js`

The existing `requireAdmin` in `index.js` checks the static `ADMIN_TOKEN` — that
is for the founder's bootstrap CLI, not for a logged-in org admin. The dashboard
needs a *session*-based admin check.

- [ ] **Step 1:** Add `requireOrgAdmin(req, res, next)` to `middleware-auth.js`:
  run after `requireAuth`, load the user, and `403` unless `user.role === 'admin'`.
  Attach the loaded user to `req.currentUser` so handlers do not re-query.

- [ ] **Step 2:** Unit-test it: a member session → 403, an admin session → passes.

- [ ] **Step 3: Commit** — `feat: add session-based org-admin middleware`.

### Task B2: Aggregate metrics, with minimum-N suppression

**Files:**
- Create: `server/aggregates.js`
- Create: `server/test-aggregates.js`
- Modify: `server/index.js`

This is the privacy-critical task. `aggregates.js` owns every query that reads
across employees, and the **only** way it returns a number is through a helper
that enforces the minimum group size.

- [ ] **Step 1: Write `server/aggregates.js`** exporting:
  - `MIN_GROUP = 5` — the suppression threshold.
  - `suppress(value, n)` — returns `value` if `n >= MIN_GROUP`, else the
    sentinel `{ suppressed: true, reason: 'min-group' }`.
  - `orgParticipation(orgId, sinceDays)` — distinct employees with ≥1 check-in
    in the window, and the org's total member count, as `{ active, total }`
    (counts ≥ MIN_GROUP are fine to show; if `total < MIN_GROUP` suppress the
    whole org view).
  - `modalityDistribution(orgId, kind, sinceDays, { teamId })` — bucket the
    `check_ins.payload` for one `kind` into coarse bands (defined per modality),
    return `{ buckets: [...], n }` run through `suppress`.
  Every function is org-scoped (`WHERE org_id = $1`) and parameterised.

- [ ] **Step 2: Write `server/test-aggregates.js`** — seed an org with 4 users +
  check-ins, assert the result is suppressed; add a 5th, assert it is now
  returned; assert one org's data never appears in another org's query.

- [ ] **Step 3:** Run, expect FAIL, then implement, then PASS.

- [ ] **Step 4:** Add the read routes to `index.js`, all behind
  `requireAuth, requireOrgAdmin`, scoped to `req.currentUser.org_id` (never an
  org id from the request — same rule as `check_ins` writes):
  - `GET /api/admin/overview?days=30` — participation + per-modality
    distributions for the whole org.
  - `GET /api/admin/teams` — the org's teams with member counts.
  - `GET /api/admin/teams/:id/overview?days=30` — same shape as overview,
    scoped to one team, 404 if the team is not in the admin's org.

- [ ] **Step 5: Smoke-test** with an admin session cookie.

- [ ] **Step 6: Commit** — `feat: add min-N-suppressed aggregate metrics API`.

---

## Phase C: Admin dashboard UI

### Task C1: Admin route + dashboard shell

**Files:**
- Modify: `client/src/App.jsx`
- Create: `client/src/views/AdminView.jsx`
- Create: `client/src/admin-api.js`

- [ ] **Step 1:** `admin-api.js` — `fetchOverview(days)`, `fetchTeams()`,
  `fetchTeamOverview(id, days)`, all with `credentials: 'include'`.

- [ ] **Step 2:** In `App.jsx`, after sign-in, branch on `user.role`: an admin
  may toggle between the participant flow and `AdminView`; a member only ever
  sees the participant flow. Keep it a simple in-app toggle, not a router.

- [ ] **Step 3:** `AdminView.jsx` — the shell: header, a period selector
  (7 / 30 / 90 days), and slots for the panels in C2. Component-scoped styles
  via the `css` + `useCss()` pattern; reuse the design tokens.

- [ ] **Step 4:** Build, verify the shell renders for an admin and is
  unreachable for a member.

- [ ] **Step 5: Commit** — `feat: add admin dashboard shell + routing`.

### Task C2: Dashboard panels

**Files:**
- Modify: `client/src/views/AdminView.jsx`
- Create: `client/src/views/admin/ParticipationPanel.jsx`
- Create: `client/src/views/admin/ModalityPanel.jsx`

- [ ] **Step 1:** `ParticipationPanel` — active vs. total employees and the
  participation rate for the period. When the API returns the suppressed
  sentinel, render an explicit "Not enough data to show this without
  identifying individuals" state — never a zero or a blank.

- [ ] **Step 2:** `ModalityPanel` (one per modality: breath / motion / heart) —
  render the distribution buckets as a simple bar. Same suppressed-state
  handling.

- [ ] **Step 3:** Team breakdown — a team selector that re-fetches the panels
  scoped to a team; each team view is independently suppressed by the API.

- [ ] **Step 4:** Build + browser pass: seed ≥ 5 users, confirm real numbers
  show; delete down to 4, confirm the suppressed state shows. Confirm no
  individual name or raw value appears anywhere in the DOM or network responses.

- [ ] **Step 5: Commit** — `feat: add participation + modality dashboard panels`.

---

## Phase D: Employee history view

### Task D1: The employee sees their own check-ins

**Files:**
- Modify: `server/index.js`
- Create: `client/src/views/HistoryView.jsx`
- Modify: `client/src/views/ParticipantView.jsx`

The aggregate dashboard is for the employer. The employee should be able to see
their *own* full history — this is both a feature and the transparency
counterweight to Phase B.

- [ ] **Step 1:** `GET /api/me/check-ins?limit=50` — behind `requireAuth`,
  returns the caller's own `check_ins` (newest first), `WHERE user_id =
  req.auth.userId`. No org-admin can reach another person's check-ins by any
  route — only the person themselves, via this endpoint.

- [ ] **Step 2:** `HistoryView.jsx` — a reverse-chronological list of the
  caller's check-ins with date, modality, and the headline result.

- [ ] **Step 3:** Add a "History" entry point to `ParticipantView`.

- [ ] **Step 4:** Build + browser pass.

- [ ] **Step 5: Commit** — `feat: add employee check-in history view`.

---

## Out of scope (next plan)

- Self-service org-admin UI for inviting users / managing teams (still uses the
  `ADMIN_TOKEN` bootstrap endpoints).
- Exports / scheduled email reports.
- SSO.
- Longitudinal per-employee trend analytics (deliberately excluded — see the
  privacy constraint).
- The employee-facing disclosure copy explaining aggregate reporting — a content
  task to run alongside `docs/privacy-policy.md`.

## Verification summary

- Phases A–B: `npm test` green, including the new `test-aggregates.js` proving
  min-N suppression and org isolation.
- Phases C–D: `npm run build --workspace=client` clean; a browser pass proving
  the suppressed state and that no individual data reaches an admin.
