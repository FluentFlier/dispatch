#!/usr/bin/env bash
# Applies agent API + warm contacts (UseSocial-style social graph) migrations.
# Prerequisites: npx @insforge/cli login && npx @insforge/cli link
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Checking InsForge CLI context..."
if ! npx @insforge/cli whoami >/dev/null 2>&1; then
  echo "ERROR: Not logged in. Run: npx @insforge/cli login && npx @insforge/cli link"
  exit 1
fi

for sql in db/agent-api-keys.sql db/warm-contacts.sql; do
  echo "Applying ${sql}..."
  npx @insforge/cli db import "$sql" -y
done

echo "Applying feature flag (loop_warm_contacts_sync)..."
npx @insforge/cli db query "INSERT INTO feature_flags (name, enabled, description) VALUES ('loop_warm_contacts_sync', true, 'Sync warm contacts from post reactions in engagement cron') ON CONFLICT (name) DO NOTHING;" -y

echo "Done. Verify tables:"
npx @insforge/cli db tables 2>/dev/null | grep -E 'agent_api_keys|warm_contacts|social_graph_read_cache' || true
