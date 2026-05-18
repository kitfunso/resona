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

test.after(async () => {
  await pool.end();
});
