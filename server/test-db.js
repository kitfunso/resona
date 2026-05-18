import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, migrate } from './db.js';

test('pool connects and runs a trivial query', async () => {
  const { rows } = await pool.query('SELECT 1 AS x');
  assert.equal(rows[0].x, 1);
});

test('migrate is idempotent', async () => {
  await migrate();
  await migrate();
  const { rows } = await pool.query("SELECT to_regclass('public._resona_meta') AS t");
  assert.equal(rows[0].t, '_resona_meta');
});

test.after(async () => {
  await pool.end();
});
