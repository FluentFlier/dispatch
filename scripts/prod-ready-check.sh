#!/usr/bin/env bash
# Production readiness gate — run before deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }
warn() { echo "WARN: $1"; }

echo "=== Dispatch prod-ready check ==="

# Disk space (build needs headroom)
AVAIL=$(df -g . 2>/dev/null | awk 'NR==2 {print $4}' || echo "?")
if [ "$AVAIL" != "?" ] && [ "$AVAIL" -lt 2 ] 2>/dev/null; then
  fail "Disk space low (${AVAIL}GB free) — free space before npm run build"
else
  pass "Disk space OK (${AVAIL}GB free)"
fi

# Required env (local .env.local)
if [ -f .env.local ]; then
  for key in NEXT_PUBLIC_INSFORGE_URL NEXT_PUBLIC_INSFORGE_ANON_KEY TOKEN_ENCRYPTION_KEY CRON_SECRET AI_API_KEY; do
    if grep -q "^${key}=" .env.local 2>/dev/null && [ -n "$(grep "^${key}=" .env.local | cut -d= -f2- | tr -d ' \r')" ]; then
      pass "env $key set"
    else
      warn "env $key missing or empty in .env.local"
    fi
  done
  if grep -q "^INSFORGE_SERVICE_ROLE_KEY=" .env.local 2>/dev/null; then
    pass "env INSFORGE_SERVICE_ROLE_KEY set"
  else
    fail "INSFORGE_SERVICE_ROLE_KEY required for prod cron + ingest"
  fi
else
  fail ".env.local missing"
fi

echo "--- tests ---"
if npm test >/dev/null 2>&1; then
  pass "npm test"
else
  fail "npm test"
fi

echo "--- lint ---"
if npm run lint >/dev/null 2>&1; then
  pass "npm run lint"
else
  warn "npm run lint (check warnings)"
fi

echo "--- build ---"
if npm run build >/tmp/dispatch-build.log 2>&1; then
  pass "npm run build"
else
  fail "npm run build — see /tmp/dispatch-build.log"
  tail -5 /tmp/dispatch-build.log 2>/dev/null || true
fi

PROD_URL="${PROD_URL:-https://mm4nbzdu.insforge.site}"
HEALTH=$(curl -sS -m 15 "${PROD_URL}/api/health" 2>/dev/null || echo '{}')
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "prod health ${PROD_URL}/api/health"
else
  warn "prod health not ok: $HEALTH"
fi

SIG_CODE=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" "${PROD_URL}/signals" 2>/dev/null || echo "000")
if [ "$SIG_CODE" = "200" ] || [ "$SIG_CODE" = "307" ] || [ "$SIG_CODE" = "302" ]; then
  pass "prod /signals reachable ($SIG_CODE)"
else
  fail "prod /signals returns $SIG_CODE (404 = branch not deployed)"
fi

BASE="${SMOKE_BASE:-http://localhost:3002}"
if curl -sS -m 5 "${BASE}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
  echo "--- signals smoke @ $BASE ---"
  if bash "$ROOT/scripts/signals-e2e-smoke.sh" "$BASE"; then
    pass "signals API smoke"
  else
    fail "signals API smoke"
  fi
else
  warn "dev server not on $BASE — skip API smoke (start: npm run dev)"
fi

echo ""
echo "=== Migrations to apply on InsForge (in order) ==="
echo "  1. db/signals.sql"
echo "  2. db/signals-composio.sql"
echo "  3. db/signals-rls.sql"
echo "  4. db/signals-ingest-tuning.sql"
echo ""
echo "=== Prod env vars (InsForge hosting / Vercel) ==="
echo "  NEXT_PUBLIC_APP_URL=https://mm4nbzdu.insforge.site"
echo "  INSFORGE_SERVICE_ROLE_KEY, CRON_SECRET, AI_API_KEY"
echo "  TOKEN_ENCRYPTION_KEY, UNIPILE_* (LinkedIn send), COMPOSIO_* (Gmail optional)"
echo "  DEMO_SEED_ENABLED=true  # optional: allow /api/demo/seed in prod"
echo ""
echo "=== Demo user ==="
echo "  1. Sign in at /login (Google/GitHub)"
echo "  2. npx tsx scripts/seed-demo-user.ts --user-id=<your-uuid>"
echo "  3. Open /signals — 3 sample signals ready to draft"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "READY (with warnings above if any)"
else
  echo "NOT READY — fix FAIL items"
fi
exit $FAIL
