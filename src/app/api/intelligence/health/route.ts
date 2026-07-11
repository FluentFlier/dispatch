import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServiceClient } from '@/lib/insforge/server';
import { buildIntelligenceHealthReport } from '@/lib/intelligence/health';

/**
 * GET /api/intelligence/health
 * Unified probe for voice + hooks + social listening stack.
 * Requires auth — previously public and leaked env/config posture.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let client = null;
  try {
    if (process.env.INSFORGE_SERVICE_ROLE_KEY?.trim()) {
      client = getServiceClient();
    }
  } catch {
    client = null;
  }

  const report = await buildIntelligenceHealthReport(client ?? undefined);
  const httpStatus = report.status === 'missing' ? 503 : 200;
  return NextResponse.json(report, { status: httpStatus });
}
