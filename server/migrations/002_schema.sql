CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE orgs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT,
  dob        DATE,
  height_cm  INTEGER,
  sex        TEXT,
  ethnicity  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email is the login identity, and B5's magic-code lookup is global (not
-- org-scoped). It must therefore be globally unique, case-insensitively —
-- a per-org UNIQUE would let two accounts share an email and make one of
-- them permanently unreachable via login.
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE check_ins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Denormalised from users.org_id so org-scoped dashboard reads don't
  -- need a join. Written from the DB user row at insert time (see B8),
  -- never from the JWT, which can carry a stale org after a user moves.
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('breath', 'motion', 'heart')),
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX check_ins_user_created_idx ON check_ins (user_id, created_at DESC);
CREATE INDEX check_ins_org_created_idx ON check_ins (org_id, created_at DESC);
CREATE INDEX check_ins_kind_idx ON check_ins (kind, created_at DESC);

CREATE TABLE auth_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_codes_email_idx ON auth_codes (lower(email), created_at DESC);
