#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

MAILPILOT_DB_PATH="$root_dir/.mailpilot/mailpilot.sqlite" \
MAILPILOT_PROJECT_ROOT="$root_dir" \
pnpm --filter @mailpilot/local-api dev &
api_pid=$!
pnpm --filter @mailpilot/desktop dev &
vite_pid=$!

cleanup() {
  kill "$api_pid" "$vite_pid" 2>/dev/null || true
  wait "$api_pid" "$vite_pid" 2>/dev/null || true
}

trap cleanup INT TERM EXIT
wait "$vite_pid"
