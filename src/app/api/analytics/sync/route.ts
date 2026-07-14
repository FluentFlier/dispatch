import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { syncUserPostMetrics } from '@/lib/analytics/sync-user-metrics';

function metricsSyncClient() {
  return process.env.INSFORGE_SERVICE_ROLE_KEY?.trim() ? getServiceClient() : getServerClient();
}

/** POST /api/analytics/sync - refresh post metrics from connected platforms. */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await syncUserPostMetrics(metricsSyncClient(), user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
