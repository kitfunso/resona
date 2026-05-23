# scripts/

## Test database (for `npm test --workspace=server`)

The server tests run against a real Postgres (per the `always use real DB for tests` rule). A long-lived containerised PG keeps the verify step cheap to re-run.

**Start the test PG:**

```bash
scripts/test-db-up.sh
```

Idempotent. Blocks until `pg_isready`. Container is `resona-test-pg`, listens on `127.0.0.1:55432` only (never exposed externally), trust auth, user `skf_s`, database `resona_dev`. Matches the DATABASE_URL convention in `.env.example`.

**Run the tests:**

```bash
npm test --workspace=server                                    # all tests
npm test --workspace=server -- --test-name-pattern aggregates  # one suite
```

**Stop and clear the test PG:**

```bash
scripts/test-db-down.sh
```

Removes volumes too; next `test-db-up.sh` starts fresh.

## Other scripts

- `build_submission_pptx.py`: slide builder for the Watcha submission deck.
- `eval_reasoning.mjs`: LLM reasoning eval harness.
- `export_pptx_to_pdf.py`: PPT to PDF export.

## Why a docker-compose test DB

Prior to this, every test run inside a `/dev-framework-rl` episode tried to stand up an ad-hoc PG inside the test process's group. The DB died with the process and held the port from re-bind without admin. Across 4 consecutive episodes (admin-dashboard Phase A, D, B1, B2) the verify stage could not exercise the new tests. A persistent compose-managed container closes that friction loop.
