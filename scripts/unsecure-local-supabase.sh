#!/usr/bin/env bash
set -euo pipefail

readonly COMMENT="best-friend-local-supabase"
readonly PORTS="54321,54322,54324,54327"
readonly PORT_RANGE="54321:54329"

remove_rule() {
  local family="$1"
  local chain="$2"
  shift 2
  while "$family" -C "$chain" "$@" 2>/dev/null; do
    "$family" -D "$chain" "$@" >/dev/null
  done
}

remove_rule iptables INPUT ! -i lo -p tcp -m multiport --dports "$PORTS" -m comment --comment "$COMMENT" -j DROP
remove_rule iptables DOCKER-USER -p tcp -m conntrack --ctorigdstport "$PORT_RANGE" ! -s 127.0.0.1/32 -m comment --comment "$COMMENT" -j DROP

remove_rule ip6tables INPUT ! -i lo -p tcp -m multiport --dports "$PORTS" -m comment --comment "$COMMENT" -j DROP
remove_rule ip6tables DOCKER-USER -p tcp -m conntrack --ctorigdstport "$PORT_RANGE" ! -s ::1/128 -m comment --comment "$COMMENT" -j DROP

echo "Pare-feu du labo Supabase nettoye."

