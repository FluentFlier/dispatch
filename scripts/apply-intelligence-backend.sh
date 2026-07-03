#!/usr/bin/env bash
# Applies intelligence-backend.sql via InsForge CLI.
# Prerequisites: npx @insforge/cli login && npx @insforge/cli link
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Checking InsForge CLI context..."
if ! npx @insforge/cli whoami >/dev/null 2>&1; then
  echo "ERROR: Not logged in. Run: npx @insforge/cli login"
  exit 1
fi

echo "Applying all intelligence migrations (hooks + backend + evolving model)..."
bash "$ROOT/scripts/apply-all-intelligence.sh"
