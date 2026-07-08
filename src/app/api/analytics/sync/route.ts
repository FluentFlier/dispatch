import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { syncUserPostMetrics } from '@/lib/analytics/sync-user-metrics';

/** POST /api/analytics/sync — refresh post metrics from connected platforms. */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const client = getServerClient();
    const result = await syncUserPostMetrics(client, user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
