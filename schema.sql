-- D1 (SQLite) schema for the demo path. Ported from the Postgres migrations
-- 001/002 (orgs, users, check_ins). UUIDs are generated in code
-- (crypto.randomUUID()); timestamps are stored as ISO-8601 TEXT. The OTP/admin
-- tables (auth_codes, role_grants, teams, ...) are intentionally omitted — the
-- public deployment is guest-demo only.

CREATE TABLE IF NOT EXISTS orgs (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT,
  dob        TEXT,
  height_cm  INTEGER,
  sex        TEXT,
  ethnicity  TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS check_ins (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('breath', 'motion', 'heart')),
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS check_ins_user_created_idx ON check_ins (user_id, created_at DESC);
