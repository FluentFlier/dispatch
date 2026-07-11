#!/usr/bin/env bash
# Port required .env.local keys into InsForge deployment env (content-os hosting).
# Does not print secret values.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${1:-.env.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

# Keys required for prod spine + common integrations already present locally.
REQUIRED_KEYS=(
  NEXT_PUBLIC_APP_URL
  NEXT_PUBLIC_INSFORGE_URL
  NEXT_PUBLIC_INSFORGE_ANON_KEY
  INSFORGE_SERVICE_ROLE_KEY
  CRON_SECRET
  TOKEN_ENCRYPTION_KEY
  SOCIAL_PROVIDER_MODE
  UNIPILE_API_KEY
  UNIPILE_DSN
  UNIPILE_WEBHOOK_SECRET
  UNIPILE_HOSTED_CALLBACK_SECRET
  LLM_BASE_URL
  LLM_API_KEY
  LLM_MODEL
  LLM_MODEL_FAST
  LLM_MODEL_SMART
  LLM_POLISH_MODEL
  LLM_FALLBACK_BASE_URL
  LLM_FALLBACK_API_KEY
  LLM_FALLBACK_MODEL
  LLM_DAILY_HARD_CAP
  SIGNALS_INGEST_SECRET
  SIGNALS_USE_APIFY
  SIGNALS_INGEST_MODE
  COMPOSIO_API_KEY
  COMPOSIO_STATE_SECRET
  COMPOSIO_GMAIL_AUTH_CONFIG_ID
  COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID
  COMPOSIO_SLACK_AUTH_CONFIG_ID
  ADMIN_EMAILS
  WHISPER_MODEL
  BIGSET_BACKEND_URL
  TINYFISH_API_KEY
  SERPER_API_KEY
  APIFY_TOKEN
  APIFY_LINKEDIN_PROFILE_ACTOR
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_STARTER
  STRIPE_PRICE_GROWTH
  STRIPE_PRICE_PRO
  OUTREACH_SENDER_IDENTITY
  NEXT_PUBLIC_CALENDLY_URL
)

# Force production public URLs on hosting even if .env.local has localhost.
FORCE_APP_URL="${FORCE_APP_URL:-https://contentos.us}"
FORCE_INSFORGE_URL="${FORCE_INSFORGE_URL:-https://mm4nbzdu.us-east.insforge.app}"

get_val() {
  local key="$1"
  # shellcheck disable=SC1090
  grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true
}

set_count=0
skip_count=0
for key in "${REQUIRED_KEYS[@]}"; do
  val="$(get_val "$key")"
  if [[ "$key" == "NEXT_PUBLIC_APP_URL" ]]; then
    val="$FORCE_APP_URL"
  fi
  if [[ "$key" == "NEXT_PUBLIC_INSFORGE_URL" ]]; then
    val="$FORCE_INSFORGE_URL"
  fi
  if [[ -z "$val" ]]; then
    echo "skip (empty): $key"
    skip_count=$((skip_count + 1))
    continue
  fi
  echo "set: $key"
  npx @insforge/cli deployments env set "$key" "$val" >/dev/null
  set_count=$((set_count + 1))
done

echo "Done. set=$set_count skipped_empty=$skip_count"
npx @insforge/cli deployments env list
