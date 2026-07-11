import { NextRequest, NextResponse } from 'next/server';
import { getSocialProviderMode } from '@/lib/env';
import { checkComposioConfig } from '@/lib/composio/health';
import { isLlmConfigured, pingLlm } from '@/lib/llm';
import { isUnipileConfigured } from '@/lib/unipile/config';
import { checkCoreSchemaSetup } from '@/lib/db/setup-gate';
import { getServiceClient } from '@/lib/insforge/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health: deployment + dependency probe for beta monitoring.
 *
 * Pass ?probe=llm to run a LIVE LLM completion (costs 1 tiny call) — presence
 * checks alone can't catch an empty/wrong key returning 401, so this is opt-in.
 *
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
          : 'degraded' // optional — Unipile does not enforce webhook signing
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
      provider: socialMode,
      intelligence_health_url: '/api/intelligence/health',
      composio_health_url: '/api/integrations/composio/health',
    },
    { status: requiredMissing || schemaMissing ? 503 : 200 },
  );
}
