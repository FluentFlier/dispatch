import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getBrainStatus } from '@/lib/brain/pages';
import { getSafetyStatus } from '@/lib/signals/safety/guard';

export interface LoopReadinessStep {
  id: string;
  label: string;
  done: boolean;
  href: string;
  detail?: string;
}

export interface LoopReadinessResponse {
  complete: boolean;
  steps: LoopReadinessStep[];
}

/**
 * Returns a compact checklist for the create → publish → engage loop.
 * Used on Inbox so users see what's blocking warm outreach and replies.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  const [brainStatus, socialRes, postedRes, safety] = await Promise.all([
    getBrainStatus(client, user.id).catch(() => ({
      page_count: 0,
      slugs: [] as string[],
      last_updated: null,
    })),
    client.database
      .from('social_accounts')
      .select('platform, health_status')
      .eq('user_id', user.id),
    client.database
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'posted'),
    workspaceId
      ? getSafetyStatus(client, workspaceId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const linkedIn = (socialRes.data ?? []).find(
    (a) => (a as { platform: string }).platform === 'linkedin',
  ) as { platform: string; health_status?: string } | undefined;

  const linkedInOk =
    linkedIn != null &&
    linkedIn.health_status !== 'error' &&
    linkedIn.health_status !== 'disconnected';

  const brainOk = brainStatus.page_count >= 3;

  const publishedCount = postedRes.count ?? 0;
  const hasPublished = publishedCount > 0;

  const outreachReady =
    safety != null &&
    safety.settings.outreach_enabled &&
    !safety.settings.dry_run;

  const steps: LoopReadinessStep[] = [
    {
      id: 'linkedin',
      label: 'LinkedIn connected',
      done: linkedInOk,
      href: '/settings?tab=connections',
      detail: linkedInOk ? undefined : 'Required for publishing and warm outreach',
    },
    {
      id: 'brain',
      label: 'Creator memory synced',
      done: brainOk,
      href: '/dashboard',
      detail: brainOk
        ? `${brainStatus.page_count} pages`
        : 'Sync voice + profile so drafts sound like you',
    },
    {
      id: 'publish',
      label: 'At least one post published',
      done: hasPublished,
      href: '/generate',
      detail: hasPublished ? `${publishedCount} live` : 'Warm contacts sync from post reactions',
    },
    {
      id: 'outreach',
      label: 'Outreach enabled (not dry-run)',
      done: outreachReady,
      href: '/leads?view=setup',
      detail: outreachReady ? 'Sends allowed' : 'Enable in Leads → Setup when ready',
    },
  ];

  const complete = steps.every((s) => s.done);

  return NextResponse.json({ complete, steps } satisfies LoopReadinessResponse);
}
