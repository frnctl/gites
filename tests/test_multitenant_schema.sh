#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="bf-schema-test-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test \
  -v "$ROOT:/workspace:ro" \
  -d postgres:17-alpine >/dev/null

ready=false
for _ in $(seq 1 45); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" != "true" ]]; then
    echo "ERREUR: le PostgreSQL jetable s'est arrêté avant d'être prêt." >&2
    docker logs "$CONTAINER" >&2 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

if [[ "$ready" != "true" ]]; then
  echo "ERREUR: le PostgreSQL jetable n'est pas prêt après 45 secondes." >&2
  docker logs "$CONTAINER" >&2 2>/dev/null || true
  exit 1
fi

docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
  -f /workspace/tests/supabase_stub.sql >/dev/null

mapfile -t MIGRATIONS < <(
  find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '*.sql' \
    -printf '%f\n' | sort
)
for migration in "${MIGRATIONS[@]}"; do
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
    -f "/workspace/supabase/migrations/$migration" >/dev/null
done

# Le second passage garantit que toutes les migrations sont relançables.
for migration in "${MIGRATIONS[@]}"; do
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
    -f "/workspace/supabase/migrations/$migration" >/dev/null
done

docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
  -f /workspace/tests/multitenant_security.sql >/dev/null

echo "OK: schéma multi-tenant, idempotence et isolation RLS validés"
