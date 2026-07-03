#!/usr/bin/env bash
# Applies all intelligence + evolving-model migrations via InsForge CLI.
# Prerequisites: npx @insforge/cli login && npx @insforge/cli link
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Checking InsForge CLI context..."
if ! npx @insforge/cli whoami >/dev/null 2>&1; then
  echo "ERROR: Not logged in. Run: npx @insforge/cli login && npx @insforge/cli link"
  exit 1
fi

for sql in db/hooks-intelligence.sql db/intelligence-backend.sql db/evolving-model.sql; do
  echo "Applying ${sql}..."
  npx @insforge/cli db import "$sql" -y
done

echo "Done. Verify: npx @insforge/cli db tables | grep -E 'hook_|lead_|workspace_voice|edit_feedback'"
