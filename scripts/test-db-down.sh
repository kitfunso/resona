#!/usr/bin/env bash
# scripts/test-db-down.sh -- stops the test Postgres container and clears its
# volumes. Use this for a clean slate before the next test run, or to free
# the port.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not on PATH, nothing to stop" >&2
  exit 0
fi
if ! docker ps >/dev/null 2>&1; then
  echo "docker daemon not reachable, nothing to stop" >&2
  exit 0
fi

docker compose -f docker-compose.test.yml down -v
echo "test PG stopped and volumes cleared"
