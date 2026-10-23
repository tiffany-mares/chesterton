#!/usr/bin/env bash
# Chesterton demo wrapper (bash / Git Bash / macOS / Linux).
#
# Prints the browser tab order for the demo script (docs/outline.md "Demo
# script"), then boots the full stack bare-metal with
# `node e2e/run.mjs --keep-alive` -- same boot logic as the e2e floor test,
# left running instead of torn down. Ctrl+C stops every service.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/print-tabs.mjs"

echo
echo "Booting the stack (seed --reset, then every service, then the 3 demo PRs" \
     "fire once each to warm the cache)..."
echo "This runs node e2e/run.mjs --keep-alive. Press Ctrl+C to stop all services."
echo

exec node "$ROOT/e2e/run.mjs" --keep-alive
