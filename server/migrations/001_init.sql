-- Placeholder. Real tables land in 002_schema.sql (Task B3).
-- This file exists so the migration runner has something to apply
-- and the schema_migrations table gets created.
CREATE TABLE IF NOT EXISTS _resona_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO _resona_meta (key, value)
VALUES ('schema_origin', '001_init')
ON CONFLICT (key) DO NOTHING;
