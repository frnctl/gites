#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/secure-local-supabase.sh
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
if ! npx --yes supabase@2.109.1 start --exclude edge-runtime,logflare,postgres-meta,studio,supavisor,vector --yes >"$LOG" 2>&1; then
  sed -E '/"(ANON_KEY|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY|JWT_SECRET|DB_URL)":/d' "$LOG" >&2
  exit 1
fi
if ! npx --yes supabase@2.109.1 migration up --local >"$LOG" 2>&1; then
  sed -E '/(ANON_KEY|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY|JWT_SECRET|DB_URL)=/d' "$LOG" >&2
  exit 1
fi
echo "Supabase local produit demarre et migrations a jour."
