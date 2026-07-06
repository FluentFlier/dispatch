import { NextResponse } from 'next/server';
import { getSocialProviderMode } from '@/lib/env';
import { checkComposioConfig } from '@/lib/composio/health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health: deployment + dependency probe for beta monitoring.
 */
export async function GET(): Promise<NextResponse> {
  const composioHealth = checkComposioConfig();
  const checks: Record<string, 'ok' | 'missing' | 'degraded'> = {
    insforge: process.env.NEXT_PUBLIC_INSFORGE_URL && process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ? 'ok' : 'missing',
    encryption:
      process.env.NODE_ENV === 'production'
        ? process.env.TOKEN_ENCRYPTION_KEY?.length === 64
          ? 'ok'
          : 'missing'
        : 'ok',
    cron: process.env.CRON_SECRET ? 'ok' : 'missing',
    social: getSocialProviderMode() === 'unipile'
      ? process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN
        ? 'ok'
        : 'missing'
      : 'ok',
    unipile_webhook:
      getSocialProviderMode() === 'unipile'
        ? process.env.UNIPILE_WEBHOOK_SECRET?.trim()
          ? 'ok'
          : 'degraded' // optional — Unipile does not enforce webhook signing
        : 'ok',
    stripe: process.env.STRIPE_SECRET_KEY ? 'ok' : 'degraded',
    composio: composioHealth.status === 'ok' ? 'ok' : composioHealth.status,
  };

  const requiredChecks = ['insforge', 'encryption'] as const;
  const requiredMissing = requiredChecks.some((key) => checks[key] === 'missing');
  const status = requiredMissing ? 'degraded' : 'ok';

  return NextResponse.json(
    {
      status,
      service: 'content-os',
      version: process.env.npm_package_version ?? '0.1.0',
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      timestamp: new Date().toISOString(),
      checks,
      provider: getSocialProviderMode(),
      intelligence_health_url: '/api/intelligence/health',
      composio_health_url: '/api/integrations/composio/health',
    },
    { status: requiredMissing ? 503 : 200 },
  );
}
