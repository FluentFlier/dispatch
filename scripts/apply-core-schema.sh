#!/usr/bin/env bash
# Apply Content OS core schema (Write → Posts → Publish → Inbox spine).
# Prerequisites: npx @insforge/cli login && link to project dispatch (mm4nbzdu).
# See db/APPLY_ORDER.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Checking InsForge CLI context..."
npx @insforge/cli current

echo ""
echo "Applying core schema (steps 1–10 from db/APPLY_ORDER.md)..."

CORE_FILES=(
  db/schema.sql
  db/production-delta.sql
  db/creator-brain.sql
  db/multi-pillar-posts.sql
  db/pillar-weights.sql
  db/trial-column.sql
  db/engagement.sql
  db/engagement-analytics.sql
  db/warm-contacts.sql
  db/posts-service-role-rls.sql
  db/intelligence-backend.sql
  db/event-capture.sql
)

for sql in "${CORE_FILES[@]}"; do
  if [[ ! -f "$sql" ]]; then
    echo "SKIP missing: $sql"
    continue
  fi
  echo "→ $sql"
  npx @insforge/cli db import "$sql" -y
done

echo ""
echo "Done. Verify:"
echo "  npx @insforge/cli db tables | grep -E 'posts|creator_profile|social_accounts|publish_jobs|workspaces'"
