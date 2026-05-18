import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

// node-postgres does not infer the OS username or Unix socket path from a
// bare `postgres:///dbname` URL (unlike libpq). Build an explicit config so
// peer auth works when no user or host is embedded in the URL.
const { parse: parsePgUrl } = await import('pg-connection-string');
const parsed = parsePgUrl(DATABASE_URL);
export const pool = new pg.Pool({
  database: parsed.database,
  user: parsed.user || process.env.PGUSER || os.userInfo().username,
  host: parsed.host || process.env.PGHOST || '/var/run/postgresql',
  port: parsed.port ? Number(parsed.port) : 5432,
  password: parsed.password || undefined,
});

// Arbitrary fixed key for the migration advisory lock. Any two processes
// booting at once (e.g. rolling deploy) must serialise here so they don't
// both try to apply the same migration file.
const MIGRATION_LOCK_KEY = 4927713004;

export async function migrate() {
  // Hold a session-level advisory lock for the whole run on one dedicated
  // client. A second process calling migrate() blocks on pg_advisory_lock
  // until the first releases, then sees every migration already recorded.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file],
      );
      if (rowCount > 0) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        console.log(`[db] applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    lockClient.release();
  }
}
