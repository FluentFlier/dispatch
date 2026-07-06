#!/usr/bin/env bash
# One-shot InsForge connect + migrate + deploy for production.
# Prerequisites (one of):
#   - npx @insforge/cli login   (browser)
#   - INSFORGE_USER_API_KEY=uak_... npx @insforge/cli login --user-api-key "$INSFORGE_USER_API_KEY"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== InsForge deploy ==="

if [ -n "${INSFORGE_USER_API_KEY:-}" ]; then
  echo "Logging in with INSFORGE_USER_API_KEY..."
  npx @insforge/cli login --user-api-key "$INSFORGE_USER_API_KEY" -y
fi

if ! npx @insforge/cli whoami >/dev/null 2>&1; then
  echo "ERROR: Not logged in to InsForge."
  echo "  Run: npx @insforge/cli login"
  echo "  Or: INSFORGE_USER_API_KEY=uak_... bash scripts/deploy-insforge.sh"
  exit 1
fi

echo "CLI user:"
npx @insforge/cli whoami

if ! npx @insforge/cli current 2>/dev/null | grep -q "Project:"; then
  echo "Linking project (select dispatch / mm4nbzdu if prompted)..."
  npx @insforge/cli link -y || npx @insforge/cli link
fi

echo "--- Applying intelligence migrations ---"
bash scripts/apply-all-intelligence.sh

echo "--- Applying agent + warm-contacts migrations ---"
bash scripts/apply-agent-integration.sh

echo "--- Building ---"
npm run build

echo "--- Deploying to InsForge hosting ---"
npx @insforge/cli deployments deploy . -y

echo "--- Deployment metadata ---"
npx @insforge/cli deployments metadata 2>/dev/null || true

echo ""
echo "Smoke test:"
PROD_URL="${PROD_URL:-https://mm4nbzdu.insforge.site}"
for p in /api/health /terms /book-demo /api/intelligence/health; do
  code=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" "${PROD_URL}${p}" || echo "000")
  echo "  ${PROD_URL}${p} -> ${code}"
done
echo "DONE"
