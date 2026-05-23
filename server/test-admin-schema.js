import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, migrate } from './db.js';

test.before(async () => {
  await migrate();
});

// users.role -----------------------------------------------------------------

test('users.role column: text NOT NULL DEFAULT \'member\'', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
  `);
  assert.equal(rows.length, 1, 'users.role column missing');
  assert.equal(rows[0].data_type, 'text');
  assert.equal(rows[0].is_nullable, 'NO');
  assert.equal(rows[0].column_default, `'member'::text`);
});

test('users.role CHECK accepts only member and admin', async () => {
  // Read the CHECK clause text and assert the two allowed values appear.
  const { rows } = await pool.query(`
    SELECT cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = cc.constraint_name
       AND ccu.constraint_schema = cc.constraint_schema
     WHERE ccu.table_schema = 'public'
       AND ccu.table_name = 'users'
       AND ccu.column_name = 'role'
  `);
  assert.ok(rows.length >= 1, 'no CHECK on users.role');
  const clause = rows.map((r) => r.check_clause).join(' ');
  assert.match(clause, /'member'/);
  assert.match(clause, /'admin'/);
});

test('users has UNIQUE(id, org_id) constraint', async () => {
  const { rows } = await pool.query(`
    SELECT tc.constraint_name,
           string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'users'
       AND tc.constraint_type = 'UNIQUE'
     GROUP BY tc.constraint_name
  `);
  const match = rows.find((r) => r.cols === 'id,org_id');
  assert.ok(match, 'UNIQUE(id, org_id) on users missing');
});

// teams ----------------------------------------------------------------------

test('teams table has the expected columns and types', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'teams'
  `);
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
  assert.equal(cols.id.data_type, 'uuid');
  assert.equal(cols.id.is_nullable, 'NO');
  assert.equal(cols.org_id.data_type, 'uuid');
  assert.equal(cols.org_id.is_nullable, 'NO');
  assert.equal(cols.name.data_type, 'text');
  assert.equal(cols.name.is_nullable, 'NO');
  assert.equal(cols.created_at.data_type, 'timestamp with time zone');
  assert.equal(cols.created_at.is_nullable, 'NO');
});

test('teams.name has a CHECK enforcing length 1..80 and the ASCII class', async () => {
  const { rows } = await pool.query(`
    SELECT cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = cc.constraint_name
       AND ccu.constraint_schema = cc.constraint_schema
     WHERE ccu.table_schema = 'public'
       AND ccu.table_name = 'teams'
       AND ccu.column_name = 'name'
  `);
  const clause = rows.map((r) => r.check_clause).join(' ');
  assert.match(clause, /char_length/i);
  assert.match(clause, /80/);
});

test('teams has a primary key on id', async () => {
  const { rows } = await pool.query(`
    SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'teams'
       AND tc.constraint_type = 'PRIMARY KEY'
  `);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].column_name, 'id');
});

test('teams has UNIQUE(id, org_id) constraint', async () => {
  const { rows } = await pool.query(`
    SELECT tc.constraint_name,
           string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'teams'
       AND tc.constraint_type = 'UNIQUE'
     GROUP BY tc.constraint_name
  `);
  const match = rows.find((r) => r.cols === 'id,org_id');
  assert.ok(match, 'UNIQUE(id, org_id) on teams missing');
});

test('teams has a UNIQUE expression index on (org_id, lower(name))', async () => {
  const { rows } = await pool.query(`
    SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'teams' AND indexname = 'teams_org_name_idx'
  `);
  assert.equal(rows.length, 1, 'teams_org_name_idx missing');
  assert.match(rows[0].indexdef, /UNIQUE/i);
  assert.match(rows[0].indexdef, /org_id/);
  assert.match(rows[0].indexdef, /lower\(name\)/i);
});

test('teams.org_id FK to orgs(id) with CASCADE delete', async () => {
  const { rows } = await pool.query(`
    SELECT rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = rc.constraint_name
       AND tc.constraint_schema = rc.constraint_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'teams'
       AND tc.constraint_type = 'FOREIGN KEY'
  `);
  assert.equal(rows.length, 1, 'teams should have exactly one FK');
  assert.equal(rows[0].delete_rule, 'CASCADE');
});

// team_memberships -----------------------------------------------------------

test('team_memberships has user_id, team_id, org_id (NOT NULL), created_at', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'team_memberships'
  `);
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
  for (const name of ['user_id', 'team_id', 'org_id', 'created_at']) {
    assert.ok(cols[name], `team_memberships.${name} missing`);
    assert.equal(cols[name].is_nullable, 'NO', `${name} must be NOT NULL`);
  }
  assert.equal(cols.user_id.data_type, 'uuid');
  assert.equal(cols.team_id.data_type, 'uuid');
  assert.equal(cols.org_id.data_type, 'uuid');
  assert.equal(cols.created_at.data_type, 'timestamp with time zone');
});

test('team_memberships PK is (user_id, team_id)', async () => {
  const { rows } = await pool.query(`
    SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'team_memberships'
       AND tc.constraint_type = 'PRIMARY KEY'
     GROUP BY tc.constraint_name
  `);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cols, 'user_id,team_id');
});

test('team_memberships has two composite FKs, both CASCADE on delete', async () => {
  // For each FK on team_memberships, gather the column tuple and the
  // referenced table. We expect:
  //   (user_id, org_id) -> users(id, org_id)
  //   (team_id, org_id) -> teams(id, org_id)
  // Both with delete_rule = CASCADE.
  // Two queries, joined in JS, to avoid the row-product trap that you get
  // joining fkcu and kcu on different constraint names in one SELECT.
  const { rows: fkRows } = await pool.query(`
    SELECT rc.constraint_name,
           rc.delete_rule,
           rc.unique_constraint_name,
           string_agg(fkcu.column_name, ',' ORDER BY fkcu.ordinal_position) AS fk_cols
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = rc.constraint_name
       AND tc.constraint_schema = rc.constraint_schema
      JOIN information_schema.key_column_usage fkcu
        ON fkcu.constraint_name = rc.constraint_name
       AND fkcu.constraint_schema = rc.constraint_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'team_memberships'
     GROUP BY rc.constraint_name, rc.delete_rule, rc.unique_constraint_name
  `);
  assert.equal(fkRows.length, 2, 'team_memberships should have exactly 2 FKs');
  for (const r of fkRows) {
    assert.equal(r.delete_rule, 'CASCADE', `FK ${r.constraint_name} must CASCADE on delete`);
  }
  const userFk = fkRows.find((r) => r.fk_cols === 'user_id,org_id');
  const teamFk = fkRows.find((r) => r.fk_cols === 'team_id,org_id');
  assert.ok(userFk, 'composite FK on (user_id, org_id) missing');
  assert.ok(teamFk, 'composite FK on (team_id, org_id) missing');

  // Resolve the referenced table for each unique constraint name.
  async function refTable(uniqueConstraintName) {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.constraint_column_usage
        WHERE constraint_name = $1 AND constraint_schema = 'public'
        LIMIT 1`,
      [uniqueConstraintName],
    );
    return rows[0]?.table_name;
  }
  assert.equal(await refTable(userFk.unique_constraint_name), 'users');
  assert.equal(await refTable(teamFk.unique_constraint_name), 'teams');
});

// role_grants ----------------------------------------------------------------

test('role_grants table has expected columns', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'role_grants'
  `);
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
  assert.equal(cols.id.data_type, 'uuid');
  assert.equal(cols.id.is_nullable, 'NO');
  assert.equal(cols.user_id.data_type, 'uuid');
  assert.equal(cols.user_id.is_nullable, 'NO');
  assert.equal(cols.granted_role.data_type, 'text');
  assert.equal(cols.granted_role.is_nullable, 'NO');
  assert.equal(cols.granted_by.data_type, 'text');
  assert.equal(cols.granted_by.is_nullable, 'NO');
  assert.equal(cols.granted_at.data_type, 'timestamp with time zone');
  assert.equal(cols.granted_at.is_nullable, 'NO');
});

test('role_grants.granted_role CHECK matches the users.role allowlist', async () => {
  const { rows } = await pool.query(`
    SELECT cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = cc.constraint_name
       AND ccu.constraint_schema = cc.constraint_schema
     WHERE ccu.table_schema = 'public'
       AND ccu.table_name = 'role_grants'
       AND ccu.column_name = 'granted_role'
  `);
  const clause = rows.map((r) => r.check_clause).join(' ');
  assert.match(clause, /'member'/);
  assert.match(clause, /'admin'/);
});

test('role_grants.granted_by CHECK locks the value space', async () => {
  const { rows } = await pool.query(`
    SELECT cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = cc.constraint_name
       AND ccu.constraint_schema = cc.constraint_schema
     WHERE ccu.table_schema = 'public'
       AND ccu.table_name = 'role_grants'
       AND ccu.column_name = 'granted_by'
  `);
  const clause = rows.map((r) => r.check_clause).join(' ');
  assert.match(clause, /'admin_token'/);
  assert.match(clause, /session:/);
});

test('role_grants.user_id FK to users(id) with CASCADE delete', async () => {
  const { rows } = await pool.query(`
    SELECT rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = rc.constraint_name
       AND tc.constraint_schema = rc.constraint_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'role_grants'
       AND tc.constraint_type = 'FOREIGN KEY'
  `);
  assert.equal(rows.length, 1, 'role_grants should have exactly one FK');
  assert.equal(rows[0].delete_rule, 'CASCADE');
});

test('role_grants has an index on (user_id, granted_at DESC)', async () => {
  const { rows } = await pool.query(`
    SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'role_grants' AND indexname = 'role_grants_user_idx'
  `);
  assert.equal(rows.length, 1);
  assert.match(rows[0].indexdef, /user_id/);
  assert.match(rows[0].indexdef, /granted_at DESC/i);
});

test.after(async () => {
  await pool.end();
});
