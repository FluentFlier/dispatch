import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { enqueuePublishJob } from '@/lib/publish-queue';
import { loadSeries } from '@/lib/series/db';
import type { SocialPlatform } from '@/lib/social/types';

export const maxDuration = 120;

interface PartRow {
  id: string;
  series_position: number | null;
  scheduled_publish_at: string | null;
  series_approved: boolean;
  script: string | null;
}

/**
 * Un-pauses a series: re-enqueues publish jobs (when auto_publish) for every
 * approved, still-future part from its stored scheduled_publish_at. Past-due slots
 * are skipped so resuming doesn't fire a burst of back-dated posts. enqueue is
 * idempotent, so a double-resume never double-posts.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const series = await loadSeries(client, params.id, user.id, workspaceId);
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });

  const { data: partsData } = await client.database
    .from('posts')
    .select('id, series_position, scheduled_publish_at, series_approved, script')
    .eq('series_id', series.id)
    .eq('user_id', user.id)
    .order('series_position', { ascending: true });

  const platform = (series.platform ?? 'linkedin') as SocialPlatform;
  const now = Date.now();
  let requeued = 0;

  if (series.auto_publish) {
    for (const part of (partsData ?? []) as PartRow[]) {
      const at = part.scheduled_publish_at;
      if (!at || !part.series_approved || !part.script?.trim()) continue;
      if (new Date(at).getTime() <= now) continue; // don't back-fire past slots
      const { job } = await enqueuePublishJob({
        userId: user.id,
        postId: part.id,
        platform,
        scheduledFor: at,
      });
      if (job) requeued++;
    }
  }

  const { error } = await client.database
    .from('series')
    .update({ status: 'active' })
    .eq('id', series.id)
    .eq('user_id', user.id);
  if (error) return errorResponse('Could not resume series.', 500, error);

  return NextResponse.json({ status: 'active', requeued });
}
