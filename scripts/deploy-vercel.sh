#!/usr/bin/env bash
# Deploy Content OS to Vercel production (frontend only - InsForge stays the backend).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Vercel production deploy ==="

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: Vercel CLI not found. Run: npm i -g vercel"
  exit 1
fi

if ! vercel whoami >/dev/null 2>&1; then
  echo "ERROR: Not logged in. Run: vercel login"
  exit 1
fi

echo "Deploying content-os to production..."
vercel --prod --yes

PROD_URL="${PROD_URL:-https://contentos.us}"
echo ""
echo "Smoke test @ ${PROD_URL}:"
for p in /api/health /api/agent/v1 /api/social-graph/warm-contacts; do
  code=$(curl -sS -m 20 -o /dev/null -w "%{http_code}" "${PROD_URL}${p}" || echo "000")
  echo "  ${p} -> ${code}"
done
echo "DONE"
