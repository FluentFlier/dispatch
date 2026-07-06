import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { buildIntelligenceHealthReport } from '@/lib/intelligence/health';
import { runSocialListening } from '@/lib/hooks-intelligence';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/intelligence/run
 * Cron-authenticated runner: social listening mine + fresh health report.
 *
 * Body (optional): { "mine": true, "accounts": 20 }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runIntelligence(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runIntelligence(request);
}

async function runIntelligence(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let mine = true;
  let accounts = 20;
  try {
    const body = await request.json();
    if (typeof body.mine === 'boolean') mine = body.mine;
    if (typeof body.accounts === 'number') accounts = Math.min(50, Math.max(5, body.accounts));
  } catch {
    // defaults ok
  }

  try {
    const listening = mine
      ? await runSocialListening(accounts)
      : { status: 'skipped', accounts };

    let client = null;
    try {
      client = getServiceClient();
    } catch {
      client = null;
    }

    const health = await buildIntelligenceHealthReport(client ?? undefined);

    return NextResponse.json({ status: 'ok', listening, health });
  } catch (err) {
    return errorResponse('Intelligence run failed.', 500, err);
  }
}
