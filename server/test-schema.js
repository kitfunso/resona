import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, migrate } from './db.js';

test.before(async () => {
  await migrate();
});

test('orgs table exists with required columns', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orgs'
    ORDER BY column_name
  `);
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.equal(cols.id, 'uuid');
  assert.equal(cols.slug, 'text');
  assert.equal(cols.name, 'text');
  assert.ok(cols.created_at);
});

test('users table has org_id foreign key', async () => {
  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
  `);
  const colNames = rows.map((r) => r.column_name);
  for (const c of ['id', 'org_id', 'email', 'name', 'dob', 'height_cm', 'sex', 'ethnicity', 'created_at']) {
    assert.ok(colNames.includes(c), `users.${c} missing`);
  }
});

test('check_ins table has kind + payload jsonb + org_id', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'check_ins'
  `);
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.equal(cols.kind, 'text');
  assert.equal(cols.payload, 'jsonb');
  assert.equal(cols.org_id, 'uuid');
  assert.ok(cols.user_id);
  assert.ok(cols.created_at);
});

test('users.email is globally unique, case-insensitively', async () => {
  const { rows } = await pool.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'users_email_idx'
  `);
  assert.equal(rows.length, 1, 'users_email_idx missing');
  assert.match(rows[0].indexdef, /UNIQUE/i);
  assert.match(rows[0].indexdef, /lower\(email\)/i);
});

test('check_ins has the (org_id, kind, created_at) aggregate index (DB-1)', async () => {
  const { rows } = await pool.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'check_ins'
      AND indexname = 'check_ins_org_kind_created_idx'
  `);
  assert.equal(rows.length, 1, 'check_ins_org_kind_created_idx missing');
  assert.match(rows[0].indexdef, /org_id/);
  assert.match(rows[0].indexdef, /kind/);
  assert.match(rows[0].indexdef, /created_at/);
});

test('check_ins composite FK rejects a cross-org row with code 23503 (DB-2)', async () => {
  const { rows: oa } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ('schema-fk-a', 'Schema FK A')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const { rows: ob } = await pool.query(
    `INSERT INTO orgs (slug, name) VALUES ('schema-fk-b', 'Schema FK B')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const orgAId = oa[0].id;
  const orgBId = ob[0].id;
  await pool.query(`DELETE FROM users WHERE lower(email) = 'schema-fk@example.com'`);
  const { rows: u } = await pool.query(
    `INSERT INTO users (org_id, email) VALUES ($1, 'schema-fk@example.com') RETURNING id`,
    [orgAId],
  );
  const userId = u[0].id;
  // The user belongs to org A; a check-in claiming org B has no (id, org_id)
  // target in users and must violate the composite FK from migration 004.
  let caught;
  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, org_id, kind, payload) VALUES ($1, $2, 'heart', '{}'::jsonb)`,
      [userId, orgBId],
    );
  } catch (err) { caught = err; }
  assert.ok(caught, 'cross-org check_ins INSERT must error');
  assert.equal(caught.code, '23503', 'expected composite FK violation 23503');
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
});

test.after(async () => {
  await pool.end();
});
