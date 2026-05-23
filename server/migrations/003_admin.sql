-- 003_admin.sql --
-- Phase A: role + teams + team_memberships, with schema-level tenant
-- isolation so Phase B's team-scoped aggregate reads cannot leak across
-- orgs even if a future code path inserts memberships directly.

-- Single transaction (the migration runner in server/db.js wraps each file
-- in one BEGIN/COMMIT). ALTER + CREATE in this order is rollback-safe.

ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'admin'));

-- Required so the composite FK on team_memberships can reference
-- (users.id, org_id) as a unique target. Does not change PK semantics:
-- users.id is still globally unique on its own.
ALTER TABLE users
  ADD CONSTRAINT users_id_org_unique UNIQUE (id, org_id);

CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- DELIBERATE DIVERGENCE from the /api/me PATCH name regex:
  -- /api/me uses Unicode letters (\p{L}+\p{M}) for personal names. Team
  -- names are enterprise labels, not personal names, so we restrict to
  -- ASCII + digits + . , & ' - and length 80, supporting "Team A&B 2026"
  -- shapes while keeping the allowlist tight enough to prevent PII-as-
  -- team-name (an employee's full name written in non-ASCII script).
  name       TEXT NOT NULL
    CHECK (char_length(name) BETWEEN 1 AND 80
       AND name ~ '^[A-Za-z0-9 .,&''\-]+$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teams_id_org_unique UNIQUE (id, org_id)
);

CREATE INDEX teams_org_idx ON teams (org_id);
-- Case-insensitive name uniqueness per org. Mirrors the lower(email)
-- pattern from 002_schema.sql.
CREATE UNIQUE INDEX teams_org_name_idx ON teams (org_id, lower(name));

CREATE TABLE team_memberships (
  user_id    UUID NOT NULL,
  team_id    UUID NOT NULL,
  -- Denormalised tenant column. Composite FKs below make cross-org rows
  -- unrepresentable: an insert with (user, team) belonging to different
  -- orgs has no valid (id, org_id) target in users or teams.
  org_id     UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id),
  FOREIGN KEY (user_id, org_id) REFERENCES users(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, org_id) REFERENCES teams(id, org_id) ON DELETE CASCADE
);

CREATE INDEX team_memberships_team_idx ON team_memberships (team_id);
CREATE INDEX team_memberships_org_idx ON team_memberships (org_id);

-- Audit trail for role grants. Art 5(2) accountability + Art 32 security
-- of processing: every authority hop that unlocks aggregate org health
-- reads in Phase B leaves an unforgeable row here.
CREATE TABLE role_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_role  TEXT NOT NULL CHECK (granted_role IN ('member', 'admin')),
  -- Locks the value space so the audit trail stays machine-parseable.
  -- Bootstrap surface writes 'admin_token'; Phase B+ session-based grants
  -- will write 'session:<admin_user_id>'.
  granted_by    TEXT NOT NULL
    CHECK (granted_by = 'admin_token' OR granted_by LIKE 'session:%'),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX role_grants_user_idx ON role_grants (user_id, granted_at DESC);
