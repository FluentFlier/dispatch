import { NextRequest, NextResponse } from 'next/server';
import { buildComposioHealthReport } from '@/lib/composio/health';

/**
 * GET /api/integrations/composio/health
 * Config + optional live API probe. Cron-authenticated when ?live=true.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const live = request.nextUrl.searchParams.get('live') === 'true';

  if (live) {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const report = await buildComposioHealthReport({ live });
  const httpStatus = report.status === 'missing' ? 503 : 200;
  return NextResponse.json(report, { status: httpStatus });
}
