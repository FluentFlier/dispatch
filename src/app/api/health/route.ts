import { NextRequest, NextResponse } from 'next/server';
import { getSocialProviderMode } from '@/lib/env';
import { checkComposioConfig } from '@/lib/composio/health';
import { isLlmConfigured, pingLlm } from '@/lib/llm';
import { isUnipileConfigured } from '@/lib/unipile/config';
import { checkCoreSchemaSetup } from '@/lib/db/setup-gate';
import { getServiceClient } from '@/lib/insforge/server';

export const dynamic = 'force-dynamic';

/**
 * Non-secret summary of the resolved LLM provider config. Lets an operator verify
 * per-environment routing (local Groq/HF vs prod OpenAI) without exposing keys -
 * only the provider HOST, model ids, and boolean key-presence are returned.
 */
function llmConfigSummary() {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  let providerHost: string | null = null;
  if (baseUrl) {
    try { providerHost = new URL(baseUrl).host; } catch { providerHost = 'invalid_url'; }
  } else if (process.env.HUGGINGFACE_API_KEY?.trim()) {
    providerHost = 'router.huggingface.co (auto)';
  }
  return {
    provider_host: providerHost, // e.g. api.openai.com | api.groq.com - not secret
    model: process.env.LLM_MODEL?.trim() || null,
    model_fast: process.env.LLM_MODEL_FAST?.trim() || null,
    model_smart: process.env.LLM_MODEL_SMART?.trim() || null,
    api_key_set: Boolean(process.env.LLM_API_KEY?.trim()),
    huggingface_key_set: Boolean(process.env.HUGGINGFACE_API_KEY?.trim()),
    fallback_configured: Boolean(
      process.env.LLM_FALLBACK_BASE_URL?.trim() && process.env.LLM_FALLBACK_MODEL?.trim(),
    ),
    daily_hard_cap: process.env.LLM_DAILY_HARD_CAP?.trim() || null,
  };
}

/**
 * Non-secret presence probe for the Phase 4 canary + tracing env (spec 4.2/4.3).
 * Reports only boolean key-presence and the non-secret judge model id so an
 * operator can confirm the daily-canary judge and Langfuse wiring are
 * provisioned in prod without exposing any secret value.
 */
function observabilityConfigSummary() {
  return {
    eval_judge_model: process.env.EVAL_JUDGE_MODEL?.trim() || null,
    cerebras_key_set: Boolean(process.env.CEREBRAS_API_KEY?.trim()),
    langfuse_keys_set: Boolean(
      process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim(),
    ),
    canary_batch: process.env.CANARY_BATCH?.trim() || null,
  };
}

/**
 * GET /api/health: deployment + dependency probe for beta monitoring.
 *
 * Pass ?probe=llm to run a LIVE LLM completion (costs 1 tiny call) - presence
 * checks alone can't catch an empty/wrong key returning 401, so this is opt-in.
 * The `llm` object always reports the resolved provider host + models (no secrets).
 * Checks report readiness (ok/missing/degraded) without leaking secret values.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const composioHealth = checkComposioConfig();
  const runLlmProbe = request.nextUrl.searchParams.get('probe') === 'llm';
  const unipileConfigured = isUnipileConfigured();
  const socialMode = getSocialProviderMode();

  const checks: Record<string, 'ok' | 'missing' | 'degraded'> = {
    insforge: process.env.NEXT_PUBLIC_INSFORGE_URL && process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ? 'ok' : 'missing',
    encryption:
      process.env.NODE_ENV === 'production'
        ? process.env.TOKEN_ENCRYPTION_KEY?.length === 64
          ? 'ok'
          : 'missing'
        : 'ok',
    cron: process.env.CRON_SECRET ? 'ok' : 'missing',
    social: socialMode === 'unipile'
      ? unipileConfigured
        ? 'ok'
        : 'missing'
      : 'ok',
    unipile: socialMode === 'unipile'
      ? unipileConfigured
        ? 'ok'
        : 'missing'
      : unipileConfigured
        ? 'ok'
        : 'degraded',
    llm: isLlmConfigured() ? 'ok' : 'missing',
    unipile_webhook:
      socialMode === 'unipile'
        ? process.env.UNIPILE_WEBHOOK_SECRET?.trim()
          ? 'ok'
          : 'degraded' // optional - Unipile does not enforce webhook signing
        : 'ok',
    stripe: process.env.STRIPE_SECRET_KEY ? 'ok' : 'degraded',
    composio: composioHealth.status === 'ok' ? 'ok' : composioHealth.status,
    schema: 'degraded',
  };

  if (checks.insforge === 'ok') {
    if (process.env.INSFORGE_SERVICE_ROLE_KEY?.trim()) {
      try {
        const client = getServiceClient();
        const setup = await checkCoreSchemaSetup(client);
        checks.schema = setup.ok ? 'ok' : 'missing';
      } catch {
        checks.schema = 'degraded';
      }
    }
    // No service key → leave schema as 'degraded' (probe skipped).
  } else {
    checks.schema = 'missing';
  }

  if (runLlmProbe) {
    const llm = await pingLlm();
    checks.llm = llm === 'ok' ? 'ok' : llm === 'skipped' ? 'missing' : 'degraded';
  }

  const requiredChecks = ['insforge', 'encryption'] as const;
  const requiredMissing = requiredChecks.some((key) => checks[key] === 'missing');
  const schemaMissing = checks.schema === 'missing';
  const status = requiredMissing || schemaMissing ? 'degraded' : 'ok';

  return NextResponse.json(
    {
      status,
      service: 'content-os',
      version: process.env.npm_package_version ?? '0.1.0',
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      timestamp: new Date().toISOString(),
      checks,
      llm: llmConfigSummary(),
      observability: observabilityConfigSummary(),
      // Presence (not values) of the lead-discovery source keys, so an empty feed
      // for X / LinkedIn / web discovery can be traced to a missing prod key.
      lead_sources: {
        tinyfish: Boolean(process.env.TINYFISH_API_KEY?.trim()), // X + directory scrape
        apify: Boolean(process.env.APIFY_TOKEN?.trim()), // LinkedIn discovery
        serper: Boolean(process.env.SERPER_API_KEY?.trim()), // web-discovery fallback
      },
      provider: socialMode,
      intelligence_health_url: '/api/intelligence/health',
      composio_health_url: '/api/integrations/composio/health',
    },
    { status: requiredMissing || schemaMissing ? 503 : 200 },
  );
}
