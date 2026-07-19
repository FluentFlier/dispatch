import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { assertCanSchedule } from '@/lib/entitlements';
import { enqueuePublishJob } from '@/lib/publish-queue';
import { incrementUsage } from '@/lib/usage';
import { loadSeries } from '@/lib/series/db';
import { computeSchedule } from '@/lib/series/schedule';
import type { SocialPlatform } from '@/lib/social/types';

export const maxDuration = 120;

interface PartRow {
  id: string;
  series_position: number | null;
  status: string;
  script: string | null;
  series_approved: boolean;
}

/**
 * Confirm-all commit: verifies every part is approved + written, lays the series
 * out on the calendar by cadence, and (when auto_publish) enqueues one publish
 * job per part at its slot. This is the ONLY place auto-publish is armed - nothing
 * fires until the user has reviewed and approved every part.
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

  if (!series.cadence) {
    return NextResponse.json({ error: 'Set a posting cadence before scheduling.' }, { status: 400 });
  }

  const { data: partsData } = await client.database
    .from('posts')
    .select('id, series_position, status, script, series_approved')
    .eq('series_id', series.id)
    .eq('user_id', user.id)
    .order('series_position', { ascending: true });

  const parts = ((partsData ?? []) as PartRow[]).filter((p) => p.series_position != null);
  if (parts.length === 0) {
    return NextResponse.json({ error: 'No parts to schedule. Plan the arc first.' }, { status: 400 });
  }

  // Gate: every part must be approved AND have generated text. Report the laggards.
  const pending = parts
    .filter((p) => !p.series_approved || !p.script?.trim())
    .map((p) => p.series_position);
  if (pending.length > 0) {
    return NextResponse.json(
      { error: `Approve every part first. Pending: ${pending.join(', ')}.`, pending },
      { status: 409 },
    );
  }

  // Auto-publish requires a plan that can schedule/publish.
  if (series.auto_publish) {
    const can = await assertCanSchedule(user.id);
    if (!can.ok) return NextResponse.json({ error: can.error }, { status: 402 });
  }

  const platform = (series.platform ?? 'linkedin') as SocialPlatform;
  const slots = computeSchedule(series.cadence, parts.length);
  if (slots.length < parts.length) {
    return errorResponse('Could not compute a schedule from the cadence.', 400);
  }

  const scheduled: Array<{ position: number; at: string; queued: boolean }> = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const at = slots[i];

    await client.database
      .from('posts')
      .update({ scheduled_publish_at: at, updated_at: new Date().toISOString() })
      .eq('id', part.id)
      .eq('user_id', user.id);

    let queued = false;
    if (series.auto_publish) {
      const { job } = await enqueuePublishJob({
        userId: user.id,
        postId: part.id,
        platform,
        scheduledFor: at,
      });
      queued = Boolean(job);
      if (queued) await incrementUsage(user.id, 'scheduled_post', 1).catch(() => {});
    }
    scheduled.push({ position: part.series_position!, at, queued });
  }

  await client.database
    .from('series')
    .update({ status: 'active' })
    .eq('id', series.id)
    .eq('user_id', user.id);

  return NextResponse.json({ status: 'active', auto_publish: series.auto_publish, scheduled });
}
