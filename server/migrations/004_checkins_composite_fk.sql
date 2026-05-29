-- 004_checkins_composite_fk.sql --
-- Make check_ins tenant isolation schema-enforced, mirroring team_memberships
-- in 003_admin.sql. Bind (user_id, org_id) to users(id, org_id) so a check-in
-- whose org_id disagrees with its user's org is unrepresentable at the schema,
-- not merely blocked by the handler. Closes the SEC-2/DB-2 audit finding.
--
-- The composite target users_id_org_unique already exists (003_admin.sql).
-- The runner wraps this file in one BEGIN/COMMIT.

-- Pre-flight guard: fail loudly (not with an opaque ALTER error) if any
-- existing row already violates the invariant.
DO $$
DECLARE bad INTEGER;
BEGIN
  SELECT count(*) INTO bad
  FROM check_ins c
  LEFT JOIN users u ON u.id = c.user_id AND u.org_id = c.org_id
  WHERE u.id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'check_ins has % row(s) whose (user_id, org_id) do not match a user; resolve before adding the composite FK', bad;
  END IF;
END $$;

-- Replace the two independent single-column FKs with one composite FK to
-- users(id, org_id). org validity remains guaranteed transitively (a matching
-- users row exists, and users.org_id -> orgs). ON DELETE CASCADE preserves the
-- right-to-erasure path: deleting a user (or an org, which cascades to its
-- users) purges their check_ins.
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_user_id_fkey;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_org_id_fkey;

ALTER TABLE check_ins
  ADD CONSTRAINT check_ins_user_org_fkey
  FOREIGN KEY (user_id, org_id) REFERENCES users(id, org_id) ON DELETE CASCADE;
