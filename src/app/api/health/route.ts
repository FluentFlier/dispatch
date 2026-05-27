import { NextResponse } from 'next/server';
import { getSocialProviderMode } from '@/lib/env';

/**
 * GET /api/health — deployment + dependency probe for beta monitoring.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, 'ok' | 'missing' | 'degraded'> = {
    insforge: process.env.NEXT_PUBLIC_INSFORGE_URL && process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ? 'ok' : 'missing',
    encryption:
      process.env.NODE_ENV === 'production'
        ? process.env.TOKEN_ENCRYPTION_KEY?.length === 64
          ? 'ok'
          : 'missing'
        : 'ok',
    cron: process.env.CRON_SECRET ? 'ok' : 'missing',
    social: getSocialProviderMode() === 'ayrshare'
      ? process.env.AYRSHARE_API_KEY
        ? 'ok'
        : 'missing'
      : 'ok',
    stripe: process.env.STRIPE_SECRET_KEY ? 'ok' : 'degraded',
  };

  const unhealthy = Object.values(checks).includes('missing');
  const status = unhealthy ? 'degraded' : 'ok';

  return NextResponse.json(
    {
      status,
      service: 'dispatch',
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      checks,
      provider: getSocialProviderMode(),
    },
    { status: unhealthy ? 503 : 200 }
  );
}
