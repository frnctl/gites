#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npx --yes supabase@2.109.1 stop --yes
./scripts/unsecure-local-supabase.sh

