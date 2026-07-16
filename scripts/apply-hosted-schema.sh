#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN absent}"
: "${BF_SUPABASE_PROJECT_REF:?BF_SUPABASE_PROJECT_REF absent}"
: "${BF_SUPABASE_DB_PASSWORD:?BF_SUPABASE_DB_PASSWORD absent}"

export SUPABASE_DB_PASSWORD="$BF_SUPABASE_DB_PASSWORD"
npx --yes supabase@2.109.1 link --project-ref "$BF_SUPABASE_PROJECT_REF" --yes
npx --yes supabase@2.109.1 db push --linked --dry-run

if [[ "${BF_SUPABASE_CONFIRM_SCHEMA:-NO}" != "YES" ]]; then
  echo "Préflight terminé. Aucune migration appliquée."
  exit 0
fi

npx --yes supabase@2.109.1 db push --linked --yes
echo "Schéma de validation appliqué."

