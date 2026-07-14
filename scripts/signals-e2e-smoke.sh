#!/usr/bin/env bash
# Signals E2E smoke test (API layer). Run with dev server on :3000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
  echo "FAIL: .env.local missing - need InsForge creds"
  exit 1
fi

# shellcheck disable=SC1091
CRON=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '\r')
[ -n "$CRON" ] || { echo "FAIL: CRON_SECRET missing in .env.local"; exit 1; }
FAIL=0

BASE="${1:-http://localhost:3000}"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

echo "=== Signals E2E smoke @ $BASE ==="

# 1. Health
HEALTH=$(curl -sS -m 20 "$BASE/api/health" || true)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "GET /api/health"
else
  fail "GET /api/health - $HEALTH"
fi

# 2. Cron sync (should run without 500 even with no Unipile)
SYNC=$(curl -sS -m 60 -H "Authorization: Bearer $CRON" "$BASE/api/cron/signals-sync" || true)
if echo "$SYNC" | grep -q '"status":"ok"'; then
  pass "GET /api/cron/signals-sync"
else
  fail "GET /api/cron/signals-sync - $SYNC"
fi

# 3. Webhook ingest - need workspace_id from DB
WS=$(npx @insforge/cli db query "select id from workspaces limit 1" --json 2>/dev/null | node -e "
let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
  try { const j=JSON.parse(s); const row=j.rows?.[0]||j[0]; console.log(row?.id||''); }
  catch { console.log(''); }
});" 2>/dev/null || true)

if [ -z "$WS" ]; then
  WS=$(npx @insforge/cli db query "select workspace_id from workspace_members limit 1" 2>/dev/null | rg -o '[0-9a-f-]{36}' | head -1 || true)
fi

if [ -z "$WS" ]; then
  fail "Could not resolve workspace_id for ingest test"
else
  INGEST=$(curl -sS -m 30 -X POST "$BASE/api/signals/ingest" \
    -H "Authorization: Bearer $CRON" \
    -H "Content-Type: application/json" \
    -d "{\"workspace_id\":\"$WS\",\"platform\":\"x\",\"content\":\"Excited to announce we got into YC W25! Building fintech for startups.\",\"author_handle\":\"e2e-founder\",\"external_post_id\":\"e2e-$(date +%s)\"}" || true)
  if echo "$INGEST" | grep -q '"ok":true'; then
    pass "POST /api/signals/ingest"
  else
    fail "POST /api/signals/ingest - $INGEST"
  fi

  COUNT=$(npx @insforge/cli db query "select count(*) as c from signal_events where workspace_id='$WS'" 2>/dev/null | rg -o '[0-9]+' | tail -1 || echo 0)
  if [ "${COUNT:-0}" -gt 0 ] 2>/dev/null; then
    pass "signal_events row exists (count=$COUNT)"
  else
    fail "No signal_events after ingest"
  fi
fi

# 4. Ingest auth rejection
UNAUTH=$(curl -sS -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/signals/ingest" \
  -H "Content-Type: application/json" \
  -d '{"workspace_id":"00000000-0000-0000-0000-000000000001","platform":"x","content":"short"}' || true)
if [ "$UNAUTH" = "401" ]; then
  pass "POST /api/signals/ingest rejects missing auth"
else
  fail "Expected 401 without auth, got $UNAUTH"
fi

echo "=== Done (failures: $FAIL) ==="
exit $FAIL
