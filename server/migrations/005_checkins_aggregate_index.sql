-- 005_checkins_aggregate_index.sql --
-- The aggregate dashboard query (server/aggregates.js modalityDistribution)
-- filters check_ins on (org_id, kind, created_at) on every read. The existing
-- indexes each cover only part of that predicate -- check_ins_org_created_idx
-- (org_id, created_at) and check_ins_kind_idx (kind, created_at) -- so the
-- hottest privacy query degrades to an index scan + filter. Add the covering
-- composite index so the per-modality, time-windowed org read is a clean range
-- scan. Closes audit finding DB-1.
--
-- Plain CREATE INDEX (not CONCURRENTLY): the migration runner wraps each file in
-- one transaction and CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- At this table's scale the brief lock is acceptable. IF NOT EXISTS keeps the
-- migration idempotent.
CREATE INDEX IF NOT EXISTS check_ins_org_kind_created_idx
  ON check_ins (org_id, kind, created_at DESC);
