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

echo "Applying db/intelligence-backend.sql..."
npx @insforge/cli db import db/intelligence-backend.sql -y

echo "Done. Verify with: npx @insforge/cli db tables"
