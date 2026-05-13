# Resona Corporate Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tear out the hackathon demo-day surface (projector, leaderboard, narrator, GP Letter, DEMO_MODE) and put a corporate-product backbone in its place (server-side LLM credentials, Postgres, magic-code auth, multi-tenant org model), so further product work has a real foundation to layer on.

**Architecture:** Two phases. Phase A is purely destructive — code deletions, no new dependencies, the codebase still runs after every task. Phase B introduces Postgres (replacing `:memory:` SQLite), an OpenAI API key path (replacing the `~/.codex/auth.json` hack), a magic-code email auth flow with httpOnly-cookie JWT sessions, and an `orgs / users / check_ins` schema. The three existing analyze endpoints (`/api/analyze-blow`, `/api/analyze-neuro`, `/api/analyze-heart`) are wired through auth and persist check-ins. The admin/HR-facing dashboard is explicitly out of scope — that needs product decisions this plan doesn't make.

**Tech Stack:**
- Backend additions: `pg` 8.x (Postgres driver), `jose` 5.x (JWT sign/verify), `bcryptjs` 2.x (magic-code hashing), Node's built-in `crypto.randomInt` (6-digit codes), `cookie` 1.x (cookie parsing)
- Backend removals: `better-sqlite3`, `~/.codex/auth.json` reading path
- Frontend additions: `LoginView`, `client/src/auth.js` session helper
- Database: Postgres 15+, connected via `DATABASE_URL`
- Email: pluggable; dev default logs to console, prod injects a sender function (Resend / Mailgun / SES — left for the deploy step, not this plan)
- LLM provider: OpenAI API key in env, default model `gpt-4o` (overridable via `OPENAI_MODEL`)

---

## Phase A: Demo teardown

### Task A1: Delete ProjectorView, remove route, strip WebSocket projector subscription

**Files:**
- Delete: `client/src/views/ProjectorView.jsx`
- Modify: `client/src/App.jsx`
- Modify: `server/index.js` (WebSocket setup block around line 801)

- [ ] **Step 1: Delete the ProjectorView file**

```bash
rm client/src/views/ProjectorView.jsx
```

- [ ] **Step 2: Simplify App.jsx to single route**

Replace the entire contents of `client/src/App.jsx` with:

```jsx
import React from 'react';
import ParticipantView from './views/ParticipantView.jsx';

export default function App() {
  return <ParticipantView />;
}
```

- [ ] **Step 3: Strip the WebSocket server entirely from server/index.js**

The WebSocket server only existed to broadcast room state to projector clients. Find and delete:

1. The `import { WebSocketServer } from 'ws';` line near the top.
2. The entire `const wss = new WebSocketServer({ server, path: '/ws' });` block and all its `wss.on('connection', ...)` handlers.
3. The `broadcastToProjectors` function (find via `grep -n broadcastToProjectors server/index.js`).
4. Every call site of `broadcastToProjectors(...)`. There are calls inside `/api/analyze-blow`, `/api/analyze-heart`, and `/api/admin/reset` (the latter is deleted in task A5).

Keep the underlying HTTP server (`const server = http.createServer(app)` and `server.listen(PORT, ...)`).

- [ ] **Step 4: Remove `ws` from server dependencies**

Edit `server/package.json`, remove the `"ws": "8.18.0"` line. Then:

```bash
npm install --workspace=server
```

- [ ] **Step 5: Verify both builds still pass**

```bash
npm run build --workspace=client
node --check server/index.js
```

Expected: client build succeeds, server syntax check passes. The server won't fully boot yet because `broadcastToProjectors` references may remain — fix any remaining ReferenceErrors by deleting the orphaned calls.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx client/src/views/ProjectorView.jsx server/index.js server/package.json package-lock.json
git commit -m "feat: remove projector view and WebSocket plumbing"
```

---

### Task A2: Remove room aggregate state, narrator loop, and team-code threading

**Files:**
- Modify: `server/index.js`
- Modify: `server/prompts.js`
- Modify: `client/src/views/ParticipantView.jsx`, `client/src/views/HeartView.jsx`, `client/src/views/NeuroView.jsx` (any place that sends `teamCode` in the request body)

- [ ] **Step 1: Delete the `room` state object and helpers from `server/index.js`**

Find and remove:
- The `room` object initializer (around line 50–60: `participants`, `heartParticipants`, `recentBlows`, `narratorLog`, `newestBlowPct`, `newestHrBpm`).
- `function goalLiters(...)`.
- `function roomSnapshot()`.
- `function recordBlow(...)`.
- `function recordHeart(...)`.
- The narrator-loop `setInterval(runNarratorTick, NARRATOR_INTERVAL_MS)` line and the `runNarratorTick`, `generateNarratorLine`, `NARRATOR_INTERVAL_MS` definitions.
- All `room.X` references everywhere else in the file.

The `/api/analyze-blow` and `/api/analyze-heart` handlers will no longer record into room state — they'll simply analyze and return. (Persistence comes back in Phase B via `check_ins`.)

- [ ] **Step 2: Delete the narrator prompt**

From `server/prompts.js`, delete the entire `NARRATOR_SYSTEM` constant (line ~221) and `buildNarratorUserMessage` function (line ~243). Also remove their entries from the import list in `server/index.js`.

- [ ] **Step 3: Strip `teamCode` from all three analyze endpoints**

In `server/index.js`, find every `teamCode` reference inside `/api/analyze-blow`, `/api/analyze-neuro`, `/api/analyze-heart`. Delete the lines that extract `teamCode` from `req.body.demographics`, and delete `teamCode` from the response payload. Team membership in the corporate product comes from auth context, not request bodies.

- [ ] **Step 4: Strip `teamCode` from client requests**

```bash
grep -rn teamCode client/src/
```

For each match, delete the property from the demographics object the client builds. The most likely sites are `client/src/views/ParticipantView.jsx`, `HeartView.jsx`, and `NeuroView.jsx` near the `fetch('/api/analyze-...')` calls.

- [ ] **Step 5: Boot the server and verify the three analyze endpoints still respond**

In one terminal: `npm run dev:server`. In another:

```bash
curl -s http://localhost:3030/health | head -c 200
```

Expected: `{"ok":true, ...}` without any `room` or `narrator` keys. The server should boot without throwing ReferenceErrors.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/prompts.js client/src/views/ParticipantView.jsx client/src/views/HeartView.jsx client/src/views/NeuroView.jsx
git commit -m "feat: remove room aggregate state, narrator loop, and team-code threading"
```

---

### Task A3: Remove `DEMO_MODE` and `seedDemoMode`

**Files:**
- Modify: `server/index.js`
- Modify: `.env.example`

- [ ] **Step 1: Delete the seed function and its call**

In `server/index.js`, delete:
- The `function seedDemoMode() { ... }` block (lines ~202–238).
- The `const DEMO_MODE = String(process.env.DEMO_MODE ?? '').toLowerCase() === 'true';` line near the top.
- The `if (DEMO_MODE) seedDemoMode();` call near `server.listen(...)`.
- The `demoMode: DEMO_MODE` field from the `/health` response (around line 251).

- [ ] **Step 2: Remove DEMO_MODE from .env.example**

Edit `.env.example`, delete the `DEMO_MODE=false` line.

- [ ] **Step 3: Boot the server and verify clean startup**

```bash
npm run dev:server
```

Expected log: server boots on :3030 with no demo-seed line printed. Hit `/health`, expect no `demoMode` field.

- [ ] **Step 4: Commit**

```bash
git add server/index.js .env.example
git commit -m "feat: remove DEMO_MODE seeding"
```

---

### Task A4: Remove the GP Letter feature

**Files:**
- Modify: `server/index.js`
- Modify: `server/prompts.js`
- Modify: `client/src/views/ResultsView.jsx`

GP Letter doesn't fit corporate workplace-wellness positioning. It implies a clinical referral which Resona will explicitly disclaim it is not.

- [ ] **Step 1: Strip GP Letter from `/api/analyze-blow` in server/index.js**

Find the block in `/api/analyze-blow` that calls `askGLMJsonWithRetry` with `GP_LETTER_SYSTEM` (around line 752). Delete:
- The `let gpLetterObj; let gpLetterSource = 'ai';` lines.
- The entire try/catch block that builds `gpLetterObj`.
- The `function gpLetterFallback(...)` definition (around line 387).
- `gpLetter: gpLetterObj.letter,` and `gpLetterSource,` from the response payload.

Also remove `GP_LETTER_SYSTEM` and `buildGpLetterUserMessage` from the import list at the top.

- [ ] **Step 2: Delete the GP Letter prompt**

From `server/prompts.js`, delete `export const GP_LETTER_SYSTEM = ...` (line ~68) and `export function buildGpLetterUserMessage(...)` (line ~309).

- [ ] **Step 3: Strip GP Letter UI from ResultsView**

In `client/src/views/ResultsView.jsx`:
- Delete the entire `{/* GP Letter */}` block (starts around line 668 with `{analysis?.gpLetter && (`).
- Delete the `copyGpLetter` handler / state (search for `gpLetter` in the file and remove every match).
- Delete any CSS class definitions tied to the GP letter card (e.g. `rv-letter-body`, `rv-source-chip`) if they're declared in the same file.

- [ ] **Step 4: Verify build**

```bash
npm run build --workspace=client
node --check server/index.js
```

Expected: both pass.

- [ ] **Step 5: Smoke-test the blow endpoint without GP Letter**

```bash
npm run dev:server
```

In another terminal:

```bash
curl -s -X POST http://localhost:3030/api/analyze-blow \
  -H "Content-Type: application/json" \
  -d '{"features":{"durationSec":4.5,"peakEnv":0.6,"rmsEnergy":0.3,"activeSec05":4.0,"activeSec20":3.5,"formantHz":700},"demographics":{"age":30,"sex":"male","heightCm":175,"ethnicity":"Caucasian"}}'
```

Expected response: contains `fev1`, `fvc`, `pef`, `personalReport`, but NO `gpLetter` or `gpLetterSource` keys.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/prompts.js client/src/views/ResultsView.jsx
git commit -m "feat: remove GP Letter feature"
```

---

### Task A5: Remove `/api/admin/reset` and the projector smoke-test script, update docs

**Files:**
- Modify: `server/index.js`
- Delete: `server/test-projector-ws.js` (if it exists)
- Modify: `scratchpad.md`
- Modify: `README.md`

- [ ] **Step 1: Delete the admin reset endpoint**

In `server/index.js`, find and delete the entire `app.post('/api/admin/reset', (req, res) => { ... })` handler (around line 669). It was demo-only; a real admin surface comes later, with proper auth.

- [ ] **Step 2: Delete the projector smoke-test script if present**

```bash
ls server/test-projector-ws.js 2>/dev/null && rm server/test-projector-ws.js
```

- [ ] **Step 3: Update README.md status section**

Open `README.md`, find the `## Status` section, replace its body with:

```markdown
## Status

Hackathon prototype, three biosignal pipelines shipped (Breath, Motion, Heart). Demo-day surface (projector view, leaderboard, narrator, GP Letter, DEMO_MODE) has been removed. The codebase is mid-transition toward a corporate product. Next: Postgres + auth + multi-tenant org model (see `docs/superpowers/plans/2026-05-13-corporate-foundations.md`).
```

- [ ] **Step 4: Update scratchpad.md to mark Phase A complete**

Append a new section before `## Known issues`:

```markdown
### Phase A: Demo teardown, COMPLETE (2026-05-13) ✅

Removed in preparation for the corporate-product pivot:

- [x] ProjectorView + `/projector` route + WebSocket server + `broadcastToProjectors`.
- [x] Room aggregate state, `roomSnapshot`, `recordBlow`/`recordHeart` tracking, narrator loop, `NARRATOR_SYSTEM` prompt.
- [x] `teamCode` threading from every analyze endpoint and client view.
- [x] `DEMO_MODE` env flag + `seedDemoMode` function.
- [x] GP Letter feature (prompt, server generation, ResultsView card).
- [x] `/api/admin/reset` endpoint.
- [x] `ws` dependency dropped from `server/package.json`.

Codebase is now just the three participant-side biosignal flows + LLM-backed personal reports. Ready for corporate foundations (Phase B).
```

- [ ] **Step 5: Run full client + server check**

```bash
npm run build --workspace=client
node --check server/index.js
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add server/index.js README.md scratchpad.md
git commit -m "feat: remove admin reset endpoint, update docs for Phase A complete"
```

---

## Phase B: Corporate foundations

### Task B1: Swap Codex `~/.codex/auth.json` for `OPENAI_API_KEY`

**Files:**
- Modify: `server/glm-service.js` (rename to `server/llm.js` at the same time)
- Modify: `server/index.js` (import path + initialisation)
- Modify: `server/test-glm.js` (rename to `server/test-llm.js`)
- Modify: `server/package.json` (add `openai` dep, drop `@mariozechner/pi-ai`)
- Modify: `.env.example`

Production deployments cannot read a developer's home directory. Move to a server-held API key.

- [ ] **Step 1: Add the `openai` SDK dependency, drop pi-ai**

Edit `server/package.json`:

```json
"dependencies": {
  "better-sqlite3": "12.9.0",
  "cors": "2.8.5",
  "dotenv": "16.4.7",
  "express": "4.21.2",
  "openai": "4.77.0"
}
```

Then:

```bash
npm install --workspace=server
```

- [ ] **Step 2: Rewrite `server/glm-service.js` as `server/llm.js`**

```bash
mv server/glm-service.js server/llm.js
```

Replace the entire file contents with:

```js
// OpenAI-backed LLM client. Reads OPENAI_API_KEY from env. Exports the
// same surface (askGLMJson, askGLMStream, isConfigured, MODEL) as the old
// service so callers don't change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const TRACE_PATH = path.join(ROOT_DIR, 'llm-trace.log');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const API_KEY = process.env.OPENAI_API_KEY;
export const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.6;
const DEFAULT_MAX_TOKENS = 2000;

const client = API_KEY ? new OpenAI({ apiKey: API_KEY }) : null;

export function isConfigured() {
  return client !== null;
}

function traceWrite(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.appendFileSync(TRACE_PATH, line);
  } catch (err) {
    console.error('[llm-trace] write failed:', err.message);
  }
}

export async function askGLMText(messages, { tag, temperature = DEFAULT_TEMPERATURE, max_tokens = DEFAULT_MAX_TOKENS } = {}) {
  if (!client) throw new Error('OPENAI_API_KEY is not set; cannot call LLM.');
  const started = Date.now();
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature,
      max_tokens,
    });
    const text = resp.choices?.[0]?.message?.content ?? '';
    traceWrite({ tag, ms: Date.now() - started, in: messages, out: text });
    return text;
  } catch (err) {
    traceWrite({ tag, ms: Date.now() - started, in: messages, error: err.message });
    throw err;
  }
}

export async function askGLMJson(messages, opts = {}) {
  const text = await askGLMText(messages, { ...opts, tag: opts.tag ?? 'json' });
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace > 0) {
      try { return JSON.parse(trimmed.slice(0, lastBrace + 1)); } catch {}
    }
    throw new Error(`LLM did not return valid JSON: ${err.message}`);
  }
}

// Kept for API compatibility; OpenAI streaming is not used by current callers.
export const askGLMStream = askGLMText;

// Legacy export kept for back-compat. Not used by new code.
export const AUTH_PATH = null;
```

- [ ] **Step 3: Update `server/index.js` import**

Find the line `import { MODEL, askGLMJson, askGLMStream, isConfigured, AUTH_PATH } from './glm-service.js';` and change to:

```js
import { MODEL, askGLMJson, isConfigured } from './llm.js';
```

Remove any reference to `AUTH_PATH` or `askGLMStream` if it appears further down (it shouldn't, but `grep -n AUTH_PATH server/index.js` to confirm).

- [ ] **Step 4: Rename and rewrite the connectivity script**

```bash
mv server/test-glm.js server/test-llm.js
```

Replace contents with:

```js
import 'dotenv/config';
import { askGLMText, MODEL, isConfigured } from './llm.js';

async function main() {
  if (!isConfigured()) {
    console.error('Resona LLM check: FAILED — OPENAI_API_KEY is not set.');
    process.exit(1);
  }
  process.stdout.write(`Resona LLM check: pinging ${MODEL}... `);
  try {
    const reply = await askGLMText(
      [{ role: 'user', content: 'Respond with exactly the string READY if you can hear me.' }],
      { tag: 'test-llm', temperature: 0, max_tokens: 50 },
    );
    const clean = reply.trim();
    if (/\bREADY\b/i.test(clean)) {
      console.log(`\nResona LLM check: READY`);
      console.log(`  model: ${MODEL}`);
      console.log(`  reply: ${JSON.stringify(clean)}`);
      process.exit(0);
    }
    console.error(`\nResona LLM check: FAILED, model returned unexpected text`);
    console.error(`  reply: ${JSON.stringify(clean)}`);
    process.exit(1);
  } catch (err) {
    console.error(`\nResona LLM check: FAILED`);
    console.error(`  error: ${err.message}`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 5: Update `server/package.json` script + `.env.example`**

In `server/package.json`, change:

```json
"test:llm": "node test-llm.js"
```

And in the root `package.json`, change the existing `test:glm` script to:

```json
"test:llm": "npm run test:llm --workspace=server"
```

(Keep the old `test:glm` name as an alias if you want, but the engineer can remove it.)

Replace the LLM section of `.env.example` with:

```
# LLM
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

Delete all `CODEX_*` env vars from `.env.example`.

- [ ] **Step 6: Run the connectivity test**

Set `OPENAI_API_KEY` in `.env`, then:

```bash
npm run test:llm
```

Expected: `Resona LLM check: READY` against `gpt-4o`.

- [ ] **Step 7: Commit**

```bash
git add server/llm.js server/test-llm.js server/index.js server/package.json package.json .env.example package-lock.json
git rm server/glm-service.js server/test-glm.js 2>/dev/null || true
git commit -m "feat: replace codex auth.json with OPENAI_API_KEY"
```

---

### Task B2: Add Postgres connection, migration runner, and drop better-sqlite3

**Files:**
- Create: `server/db.js`
- Create: `server/migrations/001_init.sql`
- Create: `server/test-db.js`
- Modify: `server/index.js`
- Modify: `server/package.json`
- Modify: `.env.example`

- [ ] **Step 1: Add the `pg` dependency, drop `better-sqlite3`**

Edit `server/package.json` dependencies:

```json
"dependencies": {
  "cors": "2.8.5",
  "dotenv": "16.4.7",
  "express": "4.21.2",
  "openai": "4.77.0",
  "pg": "8.13.1"
}
```

Then:

```bash
npm install --workspace=server
```

- [ ] **Step 2: Write the failing connection test**

Create `server/test-db.js`:

```js
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
  await migrate(); // running twice must not error
  const { rows } = await pool.query("SELECT to_regclass('public.users') AS t");
  assert.equal(rows[0].t, 'users');
});

test.after(async () => {
  await pool.end();
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node --test server/test-db.js
```

Expected: FAIL (`db.js` doesn't exist yet).

- [ ] **Step 4: Create the migration runner**

`server/db.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

export async function migrate() {
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
}
```

- [ ] **Step 5: Create the initial migration (empty for this task — tables come in B3)**

`server/migrations/001_init.sql`:

```sql
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
```

Wait — Task B3 needs `users` to exist for the migrate-idempotent test in B2 step 2 to pass. Adjust: rename `001_init.sql` to truly initialise users now, fold B3 into B2's migration. Replace the file contents with the schema from Task B3 (see below) and remove Task B3's separate migration step.

Actually no: keep them separate. Update `server/test-db.js` step 2 to check for `_resona_meta` instead of `users`:

Replace the second test in `server/test-db.js`:

```js
test('migrate is idempotent', async () => {
  await migrate();
  await migrate();
  const { rows } = await pool.query("SELECT to_regclass('public._resona_meta') AS t");
  assert.equal(rows[0].t, '_resona_meta');
});
```

- [ ] **Step 6: Provision a local Postgres database**

```bash
createdb resona_dev
echo "DATABASE_URL=postgres:///resona_dev" >> .env
```

If `createdb` isn't available, use `psql -c "CREATE DATABASE resona_dev"` against your local Postgres install.

- [ ] **Step 7: Re-run the test, expect PASS**

```bash
node --test server/test-db.js
```

Expected: both tests pass.

- [ ] **Step 8: Wire migrate() into server startup**

In `server/index.js`, add near the top of the file (after other imports):

```js
import { migrate } from './db.js';
```

And replace the `server.listen(...)` block at the bottom with:

```js
migrate()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[Resona] backend listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Resona] migration failed, aborting boot:', err);
    process.exit(1);
  });
```

- [ ] **Step 9: Update `.env.example`**

Add to `.env.example`:

```
# Database
DATABASE_URL=postgres:///resona_dev
```

- [ ] **Step 10: Boot and verify migration logs**

```bash
npm run dev:server
```

Expected log line: `[db] applied migration 001_init.sql` on first boot, then `[Resona] backend listening on :3030`. Restart: no migration log (already applied).

- [ ] **Step 11: Commit**

```bash
git add server/db.js server/migrations/001_init.sql server/test-db.js server/index.js server/package.json package-lock.json .env.example
git rm server/better-sqlite3-references 2>/dev/null || true  # only if any remain
git commit -m "feat: add Postgres connection, migration runner, drop better-sqlite3"
```

---

### Task B3: Schema — `orgs`, `users`, `check_ins`

**Files:**
- Create: `server/migrations/002_schema.sql`
- Create: `server/test-schema.js`

- [ ] **Step 1: Write the failing schema test**

`server/test-schema.js`:

```js
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

test('check_ins table has kind + payload jsonb', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'check_ins'
  `);
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.equal(cols.kind, 'text');
  assert.equal(cols.payload, 'jsonb');
  assert.ok(cols.user_id);
  assert.ok(cols.created_at);
});

test.after(async () => {
  await pool.end();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test server/test-schema.js
```

Expected: FAIL (tables don't exist yet).

- [ ] **Step 3: Write the migration**

`server/migrations/002_schema.sql`:

```sql
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE check_ins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('breath', 'motion', 'heart')),
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX check_ins_user_created_idx ON check_ins (user_id, created_at DESC);
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
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
node --test server/test-schema.js
```

Expected: all four tests pass. The migrate runner will pick up `002_schema.sql` automatically.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/002_schema.sql server/test-schema.js
git commit -m "feat: add orgs/users/check_ins/auth_codes schema"
```

---

### Task B4: Email-sender abstraction

**Files:**
- Create: `server/email.js`
- Create: `server/test-email.js`

For dev, log to console + write to a `dev-emails/` directory. For prod, the engineer injects a real sender (Resend / Mailgun / SES) at deploy time. This task only does the dev shape.

- [ ] **Step 1: Write the failing test**

`server/test-email.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sendEmail, resetEmailLog } from './email.js';

test.beforeEach(() => {
  resetEmailLog();
});

test('console sender records sent message', async () => {
  await sendEmail({
    to: 'alice@example.com',
    subject: 'Your Resona code',
    text: 'Your code is 123456',
  });
  const log = JSON.parse(fs.readFileSync(path.join('dev-emails', 'log.json'), 'utf8'));
  assert.equal(log.length, 1);
  assert.equal(log[0].to, 'alice@example.com');
  assert.match(log[0].text, /123456/);
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
node --test server/test-email.js
```

Expected: FAIL (`email.js` doesn't exist).

- [ ] **Step 3: Write the implementation**

`server/email.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT_DIR, 'dev-emails');
const LOG_PATH = path.join(LOG_DIR, 'log.json');

let sender = null;

export function configureEmailSender(fn) {
  sender = fn;
}

export function resetEmailLog() {
  if (fs.existsSync(LOG_DIR)) {
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
  }
}

export async function sendEmail({ to, subject, text, html }) {
  if (sender) {
    return sender({ to, subject, text, html });
  }
  // Dev fallback: append to dev-emails/log.json + log to console.
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const existing = fs.existsSync(LOG_PATH)
    ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
    : [];
  const entry = { to, subject, text, html, sentAt: new Date().toISOString() };
  existing.push(entry);
  fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2));
  console.log(`\n[email DEV] to=${to} subject=${JSON.stringify(subject)}`);
  console.log(text);
  console.log('-----');
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
node --test server/test-email.js
```

- [ ] **Step 5: Gitignore dev-emails**

Append to `.gitignore`:

```
dev-emails/
```

- [ ] **Step 6: Commit**

```bash
git add server/email.js server/test-email.js .gitignore
git commit -m "feat: add email sender abstraction with dev console fallback"
```

---

### Task B5: Magic-code request + verify endpoints with JWT session cookie

**Files:**
- Create: `server/auth.js`
- Create: `server/test-auth.js`
- Modify: `server/index.js`
- Modify: `server/package.json`
- Modify: `.env.example`

Flow: user POSTs email → server checks if a user with that email exists in any org → if yes, generates a 6-digit code, stores hash in `auth_codes`, emails the code. User POSTs `{ email, code }` → server verifies → issues JWT session cookie.

- [ ] **Step 1: Add `jose` and `bcryptjs` deps**

In `server/package.json` add:

```json
"bcryptjs": "2.4.3",
"jose": "5.9.6"
```

Then:

```bash
npm install --workspace=server
```

- [ ] **Step 2: Write the failing auth test**

`server/test-auth.js`:

```js
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pool, migrate } from './db.js';
import { requestCode, verifyCode, issueSession, verifySession } from './auth.js';
import { resetEmailLog } from './email.js';

const TEST_EMAIL = 'auth-test@example.com';

test.before(async () => {
  await migrate();
  // Provision an org + user we can authenticate as.
  const { rows: orgs } = await pool.query(
    "INSERT INTO orgs (slug, name) VALUES ('test-co', 'Test Co') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
  );
  const orgId = orgs[0].id;
  await pool.query(
    `INSERT INTO users (org_id, email) VALUES ($1, $2)
     ON CONFLICT (org_id, email) DO NOTHING`,
    [orgId, TEST_EMAIL],
  );
});

test.beforeEach(() => {
  resetEmailLog();
});

test('requestCode emails a 6-digit code to a known user', async () => {
  await requestCode(TEST_EMAIL);
  const log = JSON.parse(fs.readFileSync(path.join('dev-emails', 'log.json'), 'utf8'));
  assert.equal(log.length, 1);
  assert.match(log[0].text, /\b\d{6}\b/);
});

test('verifyCode succeeds with correct code, returns user', async () => {
  await requestCode(TEST_EMAIL);
  const log = JSON.parse(fs.readFileSync(path.join('dev-emails', 'log.json'), 'utf8'));
  const code = log[0].text.match(/\b(\d{6})\b/)[1];
  const result = await verifyCode(TEST_EMAIL, code);
  assert.ok(result.userId);
  assert.equal(result.email, TEST_EMAIL);
});

test('verifyCode rejects wrong code', async () => {
  await requestCode(TEST_EMAIL);
  await assert.rejects(verifyCode(TEST_EMAIL, '000000'), /invalid|expired/i);
});

test('verifyCode is single-use', async () => {
  await requestCode(TEST_EMAIL);
  const log = JSON.parse(fs.readFileSync(path.join('dev-emails', 'log.json'), 'utf8'));
  const code = log[0].text.match(/\b(\d{6})\b/)[1];
  await verifyCode(TEST_EMAIL, code);
  await assert.rejects(verifyCode(TEST_EMAIL, code), /invalid|expired/i);
});

test('issueSession + verifySession round-trip', async () => {
  const token = await issueSession({ userId: 'abc-123', orgId: 'org-1' });
  const payload = await verifySession(token);
  assert.equal(payload.userId, 'abc-123');
  assert.equal(payload.orgId, 'org-1');
});

test.after(async () => {
  await pool.end();
});
```

- [ ] **Step 3: Run it, verify it fails**

```bash
node --test server/test-auth.js
```

Expected: FAIL (no `auth.js`).

- [ ] **Step 4: Write the implementation**

`server/auth.js`:

```js
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { pool } from './db.js';
import { sendEmail } from './email.js';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set and at least 32 chars');
}
const SECRET_BYTES = new TextEncoder().encode(SESSION_SECRET);

function generateCode() {
  // 6 digits, zero-padded, cryptographically random.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}

export async function requestCode(email) {
  const normalized = email.trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
    [normalized],
  );
  // Always behave the same way regardless of whether the user exists,
  // to avoid leaking which emails are registered. Only actually send if the
  // user exists.
  if (rows.length === 0) return;

  const code = generateCode();
  const hash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await pool.query(
    'INSERT INTO auth_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)',
    [normalized, hash, expiresAt],
  );
  await sendEmail({
    to: normalized,
    subject: 'Your Resona sign-in code',
    text: `Your Resona sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore it.`,
  });
}

export async function verifyCode(email, code) {
  const normalized = email.trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT id, code_hash FROM auth_codes
     WHERE lower(email) = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 5`,
    [normalized],
  );
  for (const row of rows) {
    const matches = await bcrypt.compare(code, row.code_hash);
    if (matches) {
      await pool.query('UPDATE auth_codes SET consumed_at = now() WHERE id = $1', [row.id]);
      const { rows: users } = await pool.query(
        'SELECT id, org_id, email FROM users WHERE lower(email) = $1 LIMIT 1',
        [normalized],
      );
      if (users.length === 0) throw new Error('user no longer exists');
      return { userId: users[0].id, orgId: users[0].org_id, email: users[0].email };
    }
  }
  throw new Error('invalid or expired code');
}

export async function issueSession({ userId, orgId }) {
  return await new SignJWT({ userId, orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(SECRET_BYTES);
}

export async function verifySession(token) {
  const { payload } = await jwtVerify(token, SECRET_BYTES);
  return { userId: payload.userId, orgId: payload.orgId };
}

export const SESSION_COOKIE = 'resona_session';
export const SESSION_TTL_SEC_OUT = SESSION_TTL_SEC;
```

- [ ] **Step 5: Add SESSION_SECRET to .env.example**

```
# Auth
SESSION_SECRET=replace-with-a-random-32-plus-char-string
```

In your local `.env`, set a real value: `openssl rand -base64 48 | tr -d '=\n'`.

- [ ] **Step 6: Run the test, expect PASS**

```bash
node --test server/test-auth.js
```

- [ ] **Step 7: Add HTTP handlers in server/index.js**

Add near the top:

```js
import { requestCode, verifyCode, issueSession, SESSION_COOKIE, SESSION_TTL_SEC_OUT } from './auth.js';
```

Add these route handlers (location: with the other `app.post(...)` blocks):

```js
app.post('/api/auth/request', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  if (!email.includes('@')) return res.status(400).json({ error: 'invalid email' });
  try {
    await requestCode(email);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/request]', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'invalid input' });
  }
  try {
    const session = await verifyCode(email, code);
    const token = await issueSession({ userId: session.userId, orgId: session.orgId });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SEC_OUT * 1000,
      path: '/',
    });
    res.json({ ok: true, email: session.email });
  } catch (err) {
    res.status(401).json({ error: 'invalid or expired code' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});
```

The `res.cookie` API needs `cookie-parser` or Express's built-in cookie support. Express 4 supports `res.cookie` out of the box; no extra package needed.

- [ ] **Step 8: Smoke-test the endpoint with curl**

Boot the server, then in another terminal:

```bash
# Provision a test user first (psql or via Task B6's bootstrap endpoint):
psql -d resona_dev -c "INSERT INTO orgs (slug, name) VALUES ('demo', 'Demo') ON CONFLICT DO NOTHING;"
psql -d resona_dev -c "INSERT INTO users (org_id, email) SELECT id, 'me@example.com' FROM orgs WHERE slug = 'demo';"

curl -s -X POST http://localhost:3030/api/auth/request \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com"}'
```

Expected: `{"ok":true}` and a console log line `[email DEV] to=me@example.com ...` showing the 6-digit code.

Then verify:

```bash
curl -i -s -X POST http://localhost:3030/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","code":"<the 6 digits>"}'
```

Expected: `200 OK` with a `Set-Cookie: resona_session=...` header.

- [ ] **Step 9: Commit**

```bash
git add server/auth.js server/test-auth.js server/index.js server/package.json package-lock.json .env.example
git commit -m "feat: add magic-code auth with JWT session cookies"
```

---

### Task B6: Auth middleware + `/api/me` endpoint

**Files:**
- Create: `server/middleware-auth.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write the middleware**

`server/middleware-auth.js`:

```js
import { verifySession, SESSION_COOKIE } from './auth.js';
import { pool } from './db.js';

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE] ?? extractCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    const { userId, orgId } = await verifySession(token);
    req.auth = { userId, orgId };
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid session' });
  }
}

function extractCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function loadCurrentUser(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.dob, u.height_cm, u.sex, u.ethnicity,
            o.id AS org_id, o.slug AS org_slug, o.name AS org_name
       FROM users u JOIN orgs o ON o.id = u.org_id
       WHERE u.id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Add `/api/me` GET + PATCH in server/index.js**

```js
import { requireAuth, loadCurrentUser } from './middleware-auth.js';

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await loadCurrentUser(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user });
});

app.patch('/api/me', requireAuth, async (req, res) => {
  const { name, dob, heightCm, sex, ethnicity } = req.body ?? {};
  const allowed = {};
  if (typeof name === 'string') allowed.name = name.slice(0, 200);
  if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)) allowed.dob = dob;
  if (Number.isInteger(heightCm) && heightCm > 50 && heightCm < 250) allowed.height_cm = heightCm;
  if (typeof sex === 'string') allowed.sex = sex.slice(0, 32);
  if (typeof ethnicity === 'string') allowed.ethnicity = ethnicity.slice(0, 64);
  const keys = Object.keys(allowed);
  if (keys.length === 0) return res.json({ user: await loadCurrentUser(req.auth.userId) });
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => allowed[k]);
  values.push(req.auth.userId);
  await pool.query(`UPDATE users SET ${setClause} WHERE id = $${values.length}`, values);
  res.json({ user: await loadCurrentUser(req.auth.userId) });
});
```

- [ ] **Step 3: Smoke-test**

After logging in via the previous task's flow (you'll have a session cookie):

```bash
# Save cookie from the verify step into cookies.txt, then:
curl -s --cookie cookies.txt http://localhost:3030/api/me
```

Expected: `{"user": { ... }}` containing the user row.

```bash
curl -s --cookie cookies.txt -X PATCH http://localhost:3030/api/me \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","heightCm":170,"sex":"female","ethnicity":"South Asian"}'
```

Expected: returns the updated user.

- [ ] **Step 4: Commit**

```bash
git add server/middleware-auth.js server/index.js
git commit -m "feat: add auth middleware + /api/me get/patch"
```

---

### Task B7: Org bootstrap admin endpoint

**Files:**
- Modify: `server/index.js`
- Modify: `.env.example`

Real admin UI is out of scope. For now, a single endpoint protected by a static admin token in env lets the founder create orgs and seed users. This is enough to onboard a pilot customer manually.

- [ ] **Step 1: Add ADMIN_TOKEN to .env.example**

```
# Admin bootstrap (rotate on prod)
ADMIN_TOKEN=replace-with-random-string
```

- [ ] **Step 2: Add the endpoint in server/index.js**

```js
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'admin disabled' });
  const provided = req.headers['x-admin-token'];
  if (provided !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.post('/api/admin/orgs', requireAdmin, async (req, res) => {
  const { slug, name, firstUserEmail } = req.body ?? {};
  if (typeof slug !== 'string' || !/^[a-z0-9-]{2,40}$/.test(slug)) {
    return res.status(400).json({ error: 'invalid slug (lowercase, digits, hyphens, 2-40 chars)' });
  }
  if (typeof name !== 'string' || name.length < 1) {
    return res.status(400).json({ error: 'invalid name' });
  }
  if (typeof firstUserEmail !== 'string' || !firstUserEmail.includes('@')) {
    return res.status(400).json({ error: 'invalid firstUserEmail' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: orgs } = await client.query(
      'INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id',
      [slug, name],
    );
    const { rows: users } = await client.query(
      'INSERT INTO users (org_id, email) VALUES ($1, lower($2)) RETURNING id, email',
      [orgs[0].id, firstUserEmail],
    );
    await client.query('COMMIT');
    res.json({ org: { id: orgs[0].id, slug, name }, firstUser: users[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'slug or email already exists' });
    console.error('[admin/orgs]', err);
    res.status(500).json({ error: 'failed' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { orgSlug, email } = req.body ?? {};
  if (typeof orgSlug !== 'string' || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid input' });
  }
  const { rows: orgs } = await pool.query('SELECT id FROM orgs WHERE slug = $1', [orgSlug]);
  if (orgs.length === 0) return res.status(404).json({ error: 'org not found' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (org_id, email) VALUES ($1, lower($2)) RETURNING id, email',
      [orgs[0].id, email],
    );
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'email already exists in this org' });
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'failed' });
  }
});
```

- [ ] **Step 3: Smoke-test**

```bash
curl -s -X POST http://localhost:3030/api/admin/orgs \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $(grep ADMIN_TOKEN .env | cut -d= -f2)" \
  -d '{"slug":"acme","name":"Acme Inc","firstUserEmail":"founder@acme.com"}'
```

Expected: `{"org": {...}, "firstUser": {...}}`. Re-running returns 409.

- [ ] **Step 4: Commit**

```bash
git add server/index.js .env.example
git commit -m "feat: add admin bootstrap endpoints for orgs and users"
```

---

### Task B8: Wire auth + persistence into the three analyze endpoints

**Files:**
- Modify: `server/index.js`

The analyze endpoints currently accept demographics in the request body and don't persist results. After this task, they require a session, read demographics from the authenticated user (falling back to request-body overrides for transient fields like age-at-test if needed), and write a row to `check_ins`.

- [ ] **Step 1: Apply requireAuth middleware to all three analyze endpoints**

In `server/index.js`, change the route definitions from:

```js
app.post('/api/analyze-blow', async (req, res) => { ... })
app.post('/api/analyze-neuro', async (req, res) => { ... })
app.post('/api/analyze-heart', async (req, res) => { ... })
```

To:

```js
app.post('/api/analyze-blow', requireAuth, async (req, res) => { ... })
app.post('/api/analyze-neuro', requireAuth, async (req, res) => { ... })
app.post('/api/analyze-heart', requireAuth, async (req, res) => { ... })
```

- [ ] **Step 2: Replace the demographics source inside each handler**

For each of the three handlers, near the top of the function body, replace any line that extracts demographics from `req.body` with:

```js
const user = await loadCurrentUser(req.auth.userId);
if (!user) return res.status(404).json({ error: 'user not found' });
const ageYears = user.dob
  ? Math.floor((Date.now() - new Date(user.dob).getTime()) / (365.25 * 86400 * 1000))
  : null;
const demographics = {
  age: ageYears,
  sex: user.sex,
  heightCm: user.height_cm,
  ethnicity: user.ethnicity,
};
if (!ageYears || !demographics.sex || !demographics.heightCm) {
  return res.status(400).json({ error: 'profile incomplete; PATCH /api/me first' });
}
```

(For Neuro and Heart, only `age` and `sex` are strictly required — leave `heightCm` optional in those two handlers if the analyze function permits.)

- [ ] **Step 3: Persist each successful analysis as a check-in**

At the end of each handler, just before `res.json(...)`, insert:

```js
// /api/analyze-blow
await pool.query(
  `INSERT INTO check_ins (user_id, kind, payload) VALUES ($1, 'breath', $2::jsonb)`,
  [req.auth.userId, JSON.stringify({ features: req.body.features, estimate, atsFlags: flags, personalReport })],
);
```

```js
// /api/analyze-neuro
await pool.query(
  `INSERT INTO check_ins (user_id, kind, payload) VALUES ($1, 'motion', $2::jsonb)`,
  [req.auth.userId, JSON.stringify({ tremor: req.body.tremor, gait: req.body.gait, neuroReport })],
);
```

```js
// /api/analyze-heart
await pool.query(
  `INSERT INTO check_ins (user_id, kind, payload) VALUES ($1, 'heart', $2::jsonb)`,
  [req.auth.userId, JSON.stringify({ heart: req.body.heart, heartReport })],
);
```

(Variable names in each handler may differ — adapt to whatever locals the function builds before responding.)

- [ ] **Step 4: Smoke-test the whole flow**

```bash
# Log in (use the dev-emails console output for the code):
curl -s -X POST http://localhost:3030/api/auth/request -H "Content-Type: application/json" -d '{"email":"founder@acme.com"}'
# ... read the code from server logs ...
curl -c cookies.txt -s -X POST http://localhost:3030/api/auth/verify -H "Content-Type: application/json" -d '{"email":"founder@acme.com","code":"<code>"}'

# Fill in profile:
curl -b cookies.txt -s -X PATCH http://localhost:3030/api/me -H "Content-Type: application/json" -d '{"name":"Founder","dob":"1990-01-01","heightCm":175,"sex":"male","ethnicity":"Caucasian"}'

# Call analyze-blow:
curl -b cookies.txt -s -X POST http://localhost:3030/api/analyze-blow \
  -H "Content-Type: application/json" \
  -d '{"features":{"durationSec":4.5,"peakEnv":0.6,"rmsEnergy":0.3,"activeSec05":4.0,"activeSec20":3.5,"formantHz":700}}'
```

Expected: returns FEV1/FVC/PEF + personalReport, no demographics required in the request body.

Verify persistence:

```bash
psql -d resona_dev -c "SELECT id, kind, created_at FROM check_ins ORDER BY created_at DESC LIMIT 5;"
```

Expected: one row with `kind='breath'`.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: require auth on analyze endpoints, persist check-ins"
```

---

### Task B9: Client — `LoginView` + session bootstrap in App.jsx

**Files:**
- Create: `client/src/views/LoginView.jsx`
- Create: `client/src/auth.js`
- Modify: `client/src/App.jsx`
- Modify: `client/src/api.js` (ensure `credentials: 'include'` on all requests)

- [ ] **Step 1: Update api.js to include credentials**

In `client/src/api.js`, find every `fetch(...)` call and add `credentials: 'include'` to the options object. Example:

```js
const resp = await fetch('/api/analyze-blow', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

- [ ] **Step 2: Create the auth helper**

`client/src/auth.js`:

```js
export async function fetchMe() {
  const resp = await fetch('/api/me', { credentials: 'include' });
  if (resp.status === 401) return null;
  if (!resp.ok) throw new Error(`me fetch failed: ${resp.status}`);
  const { user } = await resp.json();
  return user;
}

export async function requestSignInCode(email) {
  const resp = await fetch('/api/auth/request', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!resp.ok) throw new Error('request failed');
}

export async function verifySignInCode(email, code) {
  const resp = await fetch('/api/auth/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error ?? 'verify failed');
  }
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function patchMe(patch) {
  const resp = await fetch('/api/me', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error('patch failed');
  const { user } = await resp.json();
  return user;
}
```

- [ ] **Step 3: Create LoginView**

`client/src/views/LoginView.jsx`:

```jsx
import React, { useState } from 'react';
import { requestSignInCode, verifySignInCode } from '../auth.js';

export default function LoginView({ onSignedIn }) {
  const [stage, setStage] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitEmail(e) {
    e.preventDefault();
    if (!email.includes('@')) return setError('Please enter a valid email.');
    setBusy(true); setError('');
    try {
      await requestSignInCode(email);
      setStage('code');
    } catch (err) {
      setError('Could not send code. Try again in a moment.');
    } finally { setBusy(false); }
  }

  async function submitCode(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
    setBusy(true); setError('');
    try {
      await verifySignInCode(email, code);
      onSignedIn();
    } catch (err) {
      setError('Code invalid or expired. Request a new one.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login-view">
      <h1>Sign in to Resona</h1>
      {stage === 'email' && (
        <form onSubmit={submitEmail}>
          <label>
            Your work email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Sending...' : 'Send me a code'}
          </button>
        </form>
      )}
      {stage === 'code' && (
        <form onSubmit={submitCode}>
          <p>We sent a 6-digit code to <strong>{email}</strong>.</p>
          <label>
            Code
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Verifying...' : 'Sign in'}
          </button>
          <button type="button" onClick={() => setStage('email')} disabled={busy}>
            Use a different email
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Wire session bootstrap into App.jsx**

Replace `client/src/App.jsx` with:

```jsx
import React, { useEffect, useState } from 'react';
import ParticipantView from './views/ParticipantView.jsx';
import LoginView from './views/LoginView.jsx';
import { fetchMe } from './auth.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function reloadUser() {
    setLoading(true);
    try {
      setUser(await fetchMe());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reloadUser(); }, []);

  if (loading) return <div className="app-loading">Loading...</div>;
  if (!user) return <LoginView onSignedIn={reloadUser} />;
  return <ParticipantView user={user} onSignOut={reloadUser} />;
}
```

- [ ] **Step 5: Verify build + flow**

```bash
npm run build --workspace=client
npm run dev
```

Open http://localhost:5174 in a browser. Expected: LoginView renders. Enter the bootstrapped admin user's email, get the code from the server console, enter it, ParticipantView appears.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx client/src/auth.js client/src/views/LoginView.jsx client/src/api.js
git commit -m "feat: add client LoginView, session bootstrap, credentials-include"
```

---

### Task B10: Replace OnboardingView with profile-edit-on-first-login

**Files:**
- Modify: `client/src/views/ParticipantView.jsx`
- Modify: `client/src/views/OnboardingView.jsx` (rename to `ProfileSetupView.jsx`)

The OnboardingView currently collects name/age/sex/height/ethnicity at the start of every check-in. With auth, this becomes a one-time profile setup screen that shows automatically when the user's profile is incomplete.

- [ ] **Step 1: Rename the view file**

```bash
git mv client/src/views/OnboardingView.jsx client/src/views/ProfileSetupView.jsx
```

In the renamed file, rename the default export from `OnboardingView` to `ProfileSetupView`. Update the function name and any internal references.

- [ ] **Step 2: Convert the submit handler to PATCH /api/me**

Inside `ProfileSetupView.jsx`, find the existing submit handler that builds a `demographics` object. Replace its submission with:

```js
import { patchMe } from '../auth.js';

async function handleSubmit(e) {
  e.preventDefault();
  setBusy(true); setError('');
  try {
    const dob = `${form.birthYear}-01-01`; // approximate; refine if you want a month picker
    const updated = await patchMe({
      name: form.name,
      dob,
      heightCm: Number(form.heightCm),
      sex: form.sex,
      ethnicity: form.ethnicity,
    });
    onProfileSaved(updated);
  } catch (err) {
    setError('Could not save profile. Try again.');
  } finally { setBusy(false); }
}
```

(Adapt to the actual field names that exist in the file.)

- [ ] **Step 3: Update ParticipantView to gate on profile completeness**

In `client/src/views/ParticipantView.jsx`, near the top of the component body:

```jsx
import ProfileSetupView from './ProfileSetupView.jsx';

export default function ParticipantView({ user, onSignOut }) {
  const [currentUser, setCurrentUser] = useState(user);

  const profileComplete = !!(currentUser?.dob && currentUser?.height_cm && currentUser?.sex && currentUser?.ethnicity);
  if (!profileComplete) {
    return <ProfileSetupView initial={currentUser} onProfileSaved={setCurrentUser} />;
  }

  // ... rest of the existing component, unchanged ...
}
```

Remove any code in ParticipantView that previously collected demographics per check-in — those flows now use the user object directly.

- [ ] **Step 4: Build, verify the flow**

```bash
npm run build --workspace=client
npm run dev
```

Browser flow:
1. Sign in (LoginView).
2. ProfileSetupView appears because new user has no demographics.
3. Save profile.
4. ParticipantView appears with the three module tabs.
5. Run a breath check — no demographics form, jumps straight to TAP TO BLOW.

- [ ] **Step 5: Commit**

```bash
git add client/src/views/ProfileSetupView.jsx client/src/views/ParticipantView.jsx
git commit -m "feat: replace per-checkin onboarding with one-time profile setup"
```

---

### Task B11: Update README + scratchpad to reflect Phase B complete

**Files:**
- Modify: `README.md`
- Modify: `scratchpad.md`
- Modify: `.env.example` (final review)

- [ ] **Step 1: Rewrite README Stack + Run-locally sections**

In `README.md`, replace the `## Stack` section with:

```markdown
## Stack

- Backend: Node.js, Express, Postgres (`pg`), JWT sessions (`jose`), OpenAI SDK
- Frontend: React 18 + Vite 5
- Auth: passwordless magic-code via email (6-digit code, 10-min TTL, single-use)
- LLM: OpenAI API (default `gpt-4o`, overridable via `OPENAI_MODEL`)
- Face detect: MediaPipe Tasks Vision (`@mediapipe/tasks-vision`), wasm served from `node_modules/`
- Typography: Instrument Serif, Manrope, JetBrains Mono
```

Replace the `## Run locally` section with:

```markdown
## Run locally

```bash
# 1. install workspace dependencies
npm install

# 2. provision a local Postgres database
createdb resona_dev

# 3. copy env and fill in the four required values
cp .env.example .env
# edit .env:
#   OPENAI_API_KEY=sk-...
#   DATABASE_URL=postgres:///resona_dev
#   SESSION_SECRET=$(openssl rand -base64 48 | tr -d '=\n')
#   ADMIN_TOKEN=$(openssl rand -base64 32 | tr -d '=\n')

# 4. boot the server (runs migrations automatically on startup)
npm run dev:server

# 5. bootstrap your first org + user (in another terminal)
curl -X POST http://localhost:3030/api/admin/orgs \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $(grep ADMIN_TOKEN .env | cut -d= -f2)" \
  -d '{"slug":"demo","name":"Demo Co","firstUserEmail":"you@example.com"}'

# 6. boot the frontend
npm run dev:client
# open http://localhost:5174, sign in with your email
# the magic-code is logged to the server console + dev-emails/log.json
```
```

- [ ] **Step 2: Append Phase B complete to scratchpad**

In `scratchpad.md`, append before `## Known issues`:

```markdown
### Phase B: Corporate foundations, COMPLETE (2026-05-13) ✅

Backbone for a real product. Demo-flavoured paths removed in Phase A; Phase B replaces them with a credentialed, multi-tenant backend.

- [x] OPENAI_API_KEY replaces `~/.codex/auth.json` reading. `server/glm-service.js` → `server/llm.js`. Default model `gpt-4o` (override via `OPENAI_MODEL`).
- [x] Postgres + `pg` 8.x + migration runner (`server/db.js` + `server/migrations/`). `better-sqlite3` dropped.
- [x] Schema: `orgs`, `users` (org_id FK, unique per-org email), `check_ins` (kind ∈ {breath, motion, heart}, jsonb payload, indexed by user+created_at), `auth_codes`.
- [x] Magic-code auth: 6-digit code, 10-min TTL, bcrypt-hashed at rest, single-use. `/api/auth/request` is idempotent and leaks no info about which emails exist. `/api/auth/verify` issues an HS256 JWT in an httpOnly cookie.
- [x] Auth middleware + `/api/me` GET/PATCH for profile.
- [x] Admin bootstrap endpoints (`/api/admin/orgs`, `/api/admin/users`) gated by `ADMIN_TOKEN` env.
- [x] All three analyze endpoints (blow / neuro / heart) require a session, source demographics from the authenticated user, and persist results to `check_ins`.
- [x] Client: `LoginView` + session bootstrap in `App.jsx` + `client/src/auth.js`. `OnboardingView` renamed to `ProfileSetupView` and gated to first-time-only.

What's intentionally NOT in this phase: admin/HR dashboard, time-series trend UI, anonymized team aggregates, SSO, real email sender (Resend / Mailgun / SES integration), production deploy (Fly / Render config), DPA / privacy policy text. Those land in the next plan.

### Next plan (TBD)

Admin-facing surface: who reads the aggregate data, what they see, how identity is protected. This needs product decisions (run /office-hours first).
```

- [ ] **Step 3: Final .env.example review**

`.env.example` should now contain only:

```
# Database
DATABASE_URL=postgres:///resona_dev

# LLM
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Auth
SESSION_SECRET=replace-with-a-random-32-plus-char-string

# Admin bootstrap (rotate on prod)
ADMIN_TOKEN=replace-with-random-string

# Server
PORT=3030
```

Confirm no leftover `GLM_*`, `CODEX_*`, `DEMO_MODE` keys remain.

- [ ] **Step 4: Verify everything boots cleanly from a fresh clone simulation**

```bash
rm -rf node_modules client/node_modules server/node_modules
npm install
psql -d resona_dev -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run dev:server
```

Expected: migration logs `[db] applied migration 001_init.sql` and `002_schema.sql`, then `[Resona] backend listening on :3030`. No errors.

- [ ] **Step 5: Commit**

```bash
git add README.md scratchpad.md .env.example
git commit -m "feat: update README + scratchpad for corporate-foundations complete"
```

---

## Self-review

**Spec coverage:**
- Demo teardown: ✓ projector + WebSocket + room aggregate + narrator + DEMO_MODE + GP Letter + admin/reset + teamCode all removed across tasks A1–A5.
- Corporate foundations: ✓ OPENAI_API_KEY (B1), Postgres + migrations (B2), orgs/users/check_ins schema (B3), email abstraction (B4), magic-code auth + JWT sessions (B5), middleware + /api/me (B6), admin bootstrap (B7), auth-gated analyze endpoints with persistence (B8), client LoginView + session bootstrap (B9), profile-setup gating (B10), docs (B11).
- Explicitly out of scope: admin/HR-facing dashboard, time-series UI, SSO, real email sender wiring (Resend/Mailgun), production deploy config, DPA text. These belong in a follow-up plan.

**Placeholder scan:** No "TODO/TBD/fill in details" inside step bodies. Every code change includes the actual code. The placeholder migration in Task B2 step 5 explicitly contains a real CREATE TABLE statement (`_resona_meta`), it's a placeholder for **schema content**, not a plan-failure placeholder.

**Type / name consistency:**
- `requireAuth` middleware (B6) → used in B8 by all three analyze endpoints. ✓
- `loadCurrentUser` (B6) → used in B8 for demographics resolution. ✓
- `pool` (B2) → imported in `auth.js` (B5) and `middleware-auth.js` (B6). ✓
- `SESSION_COOKIE`, `SESSION_TTL_SEC_OUT` (B5) → imported in `server/index.js` for the verify handler. ✓
- `fetchMe`, `requestSignInCode`, `verifySignInCode`, `patchMe`, `logout` (B9) → used in `App.jsx` (B9) and `ProfileSetupView.jsx` (B10). ✓
- Schema column names `dob`, `height_cm`, `sex`, `ethnicity` (B3) → consistently referenced by `/api/me` PATCH validators (B6) and the analyze handlers' demographics resolution (B8). ✓

**Known integration risks (for the executor):**
1. After Task A2, the server temporarily has no persistence at all (room state gone, Postgres not in yet). The three analyze endpoints work end-to-end but don't save anything. Acceptable: this is a real intermediate state, not a broken one.
2. Task B8 changes analyze endpoints to require auth. If you have any leftover frontend code calling them without `credentials: 'include'` (Task B9 step 1 fixes this everywhere), it will break. Run the smoke tests in B8 step 4 with cookies.
3. The `gpt-4o` default in B1 assumes OpenAI's chat completions API. If the existing PERSONAL_REPORT or HEART_REPORT prompts relied on Codex's response shape (e.g., specific reasoning format), responses may differ. Verify the personal report still renders cleanly after B1.
