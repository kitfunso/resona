#!/usr/bin/env bash
# scripts/test-db-up.sh
#
# Start the long-lived test Postgres container and block until it
# accepts connections. Idempotent: re-running while up is a no-op.
#
# After this exits zero, `npm test --workspace=server` can connect
# at postgres://skf_s@127.0.0.1:55432/resona_dev (matching the .env
# DATABASE_URL convention).
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  echo "Install Docker Desktop (Windows/macOS) or docker (Linux), then retry." >&2
  exit 1
fi

if ! docker ps >/dev/null 2>&1; then
  echo "error: docker daemon not reachable" >&2
  echo "Start Docker Desktop (or the docker service), then retry." >&2
  exit 1
fi

echo "Starting test postgres (resona-test-pg on 127.0.0.1:55432)..."
docker compose -f docker-compose.test.yml up -d

echo "Waiting for postgres to accept connections..."
until docker compose -f docker-compose.test.yml exec -T postgres pg_isready -U skf_s -d resona_dev >/dev/null 2>&1; do
  sleep 1
done

echo "test PG ready at postgres://skf_s@127.0.0.1:55432/resona_dev"
