#!/usr/bin/env bash
# Apply full Content OS schema to linked InsForge project (dispatch / mm4nbzdu).
# Skips multi-tenancy-workspace-rls.sql (breaks user_id RLS until app is ready).
# See db/APPLY_ORDER.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Checking InsForge CLI context..."
npx @insforge/cli current

FILES=(
  # 1. Core
  db/schema.sql
  db/production-delta.sql
  db/creator-brain.sql
  db/multi-pillar-posts.sql
  db/pillar-weights.sql
  db/trial-column.sql
  # 2. Publish + Inbox
  db/engagement.sql
  db/engagement-analytics.sql
  db/warm-contacts.sql
  db/posts-service-role-rls.sql
  # 3. Intelligence
  db/intelligence-backend.sql
  db/hooks-intelligence.sql
  db/evolving-model.sql
  db/migrations/llm-global-budget.sql
  # 4. Leads / Signals
  db/signals.sql
  db/signals-rls.sql
  db/signals-leads.sql
  db/signals-leads-rls.sql
  db/signals-ingest-tuning.sql
  db/signals-composio.sql
  db/icp-gtm.sql
  db/gtm-nurture.sql
  # 5. Event capture
  db/event-capture.sql
  migrations/20260702155610_create-event-research-cache.sql
  migrations/20260702165830_create-signal-profile-snapshots.sql
  migrations/20260702173000_create-linkedin-scan-state.sql
  migrations/20260702172000_event-captures-rls-policies.sql
  # 6. Agent + admin + SMS
  db/agent-api-keys.sql
  db/admin-ops.sql
  migrations/20260706180000_admin-ops.sql
  migrations/20260706225246_admin-ops-tables.sql
  db/sms-drafts.sql
  # 7. Leads follow-ups
  migrations/20260707210000_signal-leads-company-detail.sql
  migrations/20260707213000_signal-outreach-edits.sql
  migrations/20260707220000_signal-lead-contacts-linkedin-verified.sql
  migrations/20260707221000_dedupe-signal-lead-contacts.sql
  migrations/20260711140000_signal-events-keyword-match.sql
  migrations/20260703010000_subscriptions-allow-unlimited-plan.sql
  # 8. Multi-tenancy (additive only)
  db/multi-tenancy.sql
  db/backfill-workspace-id.sql
  db/backfill-creator-brain.sql
)

ok=0
fail=0
for sql in "${FILES[@]}"; do
  if [[ ! -f "$sql" ]]; then
    echo "SKIP missing: $sql"
    continue
  fi
  echo "→ $sql"
  if npx @insforge/cli db import "$sql" -y; then
    ok=$((ok + 1))
  else
    echo "WARN: import failed for $sql (continuing)"
    fail=$((fail + 1))
  fi
done

echo ""
echo "Applied ok=$ok fail=$fail"
echo "Verify: npx @insforge/cli db tables | head"
