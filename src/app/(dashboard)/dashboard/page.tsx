import Link from 'next/link';
import {
  ArrowRight,
  AlertCircle,
  PenLine,
} from 'lucide-react';
import { getServerClient, getAuthenticatedUser } from '@/lib/insforge/server';
import type { Post } from '@/lib/types';
import { PILLAR_COLORS, STATUS_BADGE, STATUS_LABELS } from '@/lib/constants';
import type { Pillar } from '@/lib/constants';
import { getActiveWorkspaceId } from '@/lib/workspace';

/** Resolve a pillar color with graceful fallback for custom pillars. */
function getPillarColor(pillar: string): string {
  return PILLAR_COLORS[pillar as Pillar] ?? '#78716C';
}
import { formatDateShort, formatRelative } from '@/lib/utils';
import TodaysPrompt from '@/components/dashboard/TodaysPrompt';
import NeedsAttention, { type AttentionItem } from '@/components/dashboard/NeedsAttention';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { getUserEntitlements } from '@/lib/entitlements';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWeekBounds(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function computeStreak(postedDates: string[]): number {
  if (postedDates.length === 0) return 0;
  const unique = Array.from(new Set(postedDates)).sort().reverse();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  const cursor = new Date(today);
  for (let i = 0; i < 365; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (unique.includes(dateStr)) {
      streak++;
    } else if (i > 0) {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Page (Server Component)
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  const user = await getAuthenticatedUser();
  const uid = user?.id;

  if (!uid) {
    // No server-side auth -- show welcome state
    return (
      <div className="max-w-lg mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <p className="section-label mb-3">CONTENT OS</p>
        <h2 className="font-serif text-[28px] font-normal tracking-[-0.025em] leading-tight text-ink mb-2">Welcome to Content OS</h2>
        <p className="text-[15px] text-ink2 mb-6 leading-relaxed">
          Write in your voice, schedule posts, and reply to comments, all in one place.
        </p>
        <a
          href="/generate"
          className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-md text-[15px] font-semibold text-text-inverse bg-accent-primary hover:bg-accent-dark transition-colors shadow-soft"
        >
          Write your first post
        </a>
      </div>
    );
  }

  const client = getServerClient();
  const { start, end } = getWeekBounds();
  const today = new Date().toISOString().slice(0, 10);
  const workspaceId = await getActiveWorkspaceId(uid);
  // Scope content queries to the active workspace (rows are backfilled).
  // creator_profile stays user-scoped until per-workspace voice ships.
  const scoped = <T,>(q: T): T => (workspaceId ? (q as { eq: (c: string, v: string) => T }).eq('workspace_id', workspaceId) : q);

  // Fire all queries in parallel
  const [weekPostsRes, pipelineRes, postedRes, streakRes, upNextRes, recentRes, weekScheduleRes, profileRes, socialRes, failedJobsRes, entitlements, pendingSignalsRes] =
    await Promise.all([
      scoped(client.database.from('posts').select('id').eq('user_id', uid).eq('status', 'posted').gte('posted_date', start).lte('posted_date', end)),
      scoped(client.database.from('posts').select('id').eq('user_id', uid).neq('status', 'posted').neq('status', 'idea')),
      scoped(client.database.from('posts').select('id').eq('user_id', uid).eq('status', 'posted')),
      scoped(client.database.from('posts').select('posted_date').eq('user_id', uid).not('posted_date', 'is', null).order('posted_date', { ascending: false })),
      scoped(client.database.from('posts').select('*').eq('user_id', uid).gte('scheduled_date', today).neq('status', 'posted').order('scheduled_date', { ascending: true }).limit(3)),
      scoped(client.database.from('posts').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(5)),
      scoped(client.database.from('posts').select('title, pillar, status').eq('user_id', uid).gte('scheduled_date', start).lte('scheduled_date', end)),
      client.database.from('creator_profile').select('display_name, content_pillars, voice_description, onboarding_complete').eq('user_id', uid).maybeSingle(),
      scoped(client.database.from('social_accounts').select('platform, connection_method, health_status').eq('user_id', uid)),
      scoped(client.database
        .from('publish_jobs')
        .select('id, platform, last_error, status')
        .eq('user_id', uid)
        .in('status', ['failed', 'dead'])
        .order('updated_at', { ascending: false })
        .limit(5)),
      getUserEntitlements(uid),
      workspaceId
        ? client.database
            .from('signal_events')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId)
            .eq('status', 'pending')
        : Promise.resolve({ count: 0, error: null }),
    ]);

  const postsThisWeek = weekPostsRes.data?.length ?? 0;
  const inPipeline = pipelineRes.data?.length ?? 0;
  const totalPosted = postedRes.data?.length ?? 0;

  const dates = (streakRes.data ?? [])
    .map((r: { posted_date: string | null }) => r.posted_date)
    .filter(Boolean) as string[];
  const streak = computeStreak(dates);

  const upNext = (upNextRes.data as Post[]) ?? [];
  const recentActivity = (recentRes.data as Post[]) ?? [];

  // Setup progress
  const creatorProfile = profileRes.data;
  const connectedPlatforms = (socialRes.data ?? []).map((s: { platform: string }) => s.platform);
  const hasConnections = connectedPlatforms.length > 0;
  const setupComplete = hasConnections;

  // Build summary for AI prompt
  const weekPosts = weekScheduleRes.data ?? [];
  const postsSummary =
    weekPosts.length > 0
      ? weekPosts
          .map((p: { title: string; pillar: string; status: string }) => `"${p.title}" (${p.pillar}, ${p.status})`)
          .join(', ')
      : 'No posts this week yet.';

  const attentionItems: AttentionItem[] = [];

  for (const job of failedJobsRes.data ?? []) {
    const row = job as { id: string; platform: string; last_error: string | null };
    attentionItems.push({
      id: `job-${row.id}`,
      type: 'publish_failed',
      title: `Publish failed on ${row.platform}`,
      detail: row.last_error ?? 'Unknown error',
      href: '/library',
      actionLabel: 'Review',
    });
  }

  const pendingSignals = pendingSignalsRes.count ?? 0;
  if (pendingSignals > 0 && !pendingSignalsRes.error) {
    attentionItems.push({
      id: 'signals-pending',
      type: 'signals',
      title: `${pendingSignals} new signal${pendingSignals === 1 ? '' : 's'} to review`,
      detail: 'Founders you follow posted about funding or accelerators.',
      href: '/signals',
      actionLabel: 'Open Signals',
    });
  }

  if (!entitlements.isPaid) {
    attentionItems.push({
      id: 'billing-upgrade',
      type: 'billing',
      title: 'Upgrade to publish and schedule',
      detail: 'Publishing requires Starter or above.',
      href: '/pricing',
      actionLabel: 'View plans',
    });
  }

  for (const acct of socialRes.data ?? []) {
    const row = acct as { platform: string; health_status?: string };
    if (row.health_status === 'error' || row.health_status === 'disconnected') {
      attentionItems.push({
        id: `auth-${row.platform}`,
        type: 'auth_expired',
        title: `${row.platform} connection needs attention`,
        detail: 'Reconnect to resume publishing.',
        href: '/settings?tab=publishing',
        actionLabel: 'Reconnect',
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-lg border border-border bg-bg-secondary shadow-card overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="p-6 md:p-8">
            <h1 className="max-w-2xl font-serif text-[36px] md:text-[40px] font-normal leading-[1.08] tracking-[-0.02em] text-ink">
              {creatorProfile?.display_name
                ? `Hi ${creatorProfile.display_name.split(' ')[0]} — what are you shipping this week?`
                : 'What are you shipping this week?'}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-6 text-ink2">
              Write a post, put it on the calendar, reply to comments. That&apos;s the loop.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/generate" className="btn-primary">
                <PenLine className="h-4 w-4" />
                Write a post
              </Link>
              {!hasConnections && (
                <Link href="/settings?tab=publishing" className="btn-secondary">
                  Connect accounts
                </Link>
              )}
            </div>
          </div>

          <div className="border-t border-border bg-bg-elevated p-6 lg:border-l lg:border-t-0">
            <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">This week</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricTile value={postsThisWeek} label="Published" />
              <MetricTile value={inPipeline} label="In progress" />
              <MetricTile value={totalPosted} label="All time" />
              <MetricTile value={streak} label="Day streak" accent />
            </div>
          </div>
        </div>
      </section>

      <QuickActions />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <NeedsAttention items={attentionItems} />

          <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-[22px] font-normal tracking-[-0.02em] text-ink">Coming up</h2>
                <p className="mt-1 text-sm text-text-secondary">Scheduled posts</p>
              </div>
              <Link href="/calendar" className="btn-ghost min-h-[40px] px-3">
                Plan week <ArrowRight size={14} />
              </Link>
            </div>

            {upNext.length === 0 ? (
              <div className="empty-state mt-4">
                <p className="font-medium text-text-primary">No posts are scheduled yet.</p>
                <p className="mt-1">Write one post, choose a platform, then put it on the calendar. That is the fastest path to seeing Content OS work.</p>
                <Link href="/generate" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-primary">
                  Draft a post <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {upNext.map((post) => (
                  <li key={post.id}>
                    <Link
                      href={`/library?post=${post.id}`}
                      className="group flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="inline-block h-9 w-1 rounded-full shrink-0"
                          style={{ backgroundColor: getPillarColor(post.pillar) }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary group-hover:text-accent-primary">{post.title}</p>
                          <p className="mt-0.5 font-mono text-xs text-ink3 capitalize">{post.platform}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pl-4 sm:pl-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-badge text-xs font-medium ${STATUS_BADGE[post.status]}`}>
                          {STATUS_LABELS[post.status]}
                        </span>
                        {post.scheduled_date && (
                          <span className="font-mono text-xs text-ink3">{formatDateShort(post.scheduled_date)}</span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          {!setupComplete && (
            <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-accent-primary shrink-0" />
                <h2 className="text-sm font-semibold text-text-primary">Connect to publish</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Your voice profile is set. Link a social account when you want to schedule or publish.
              </p>
              <Link
                href="/settings?tab=publishing"
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-bg-tertiary px-3 py-3 text-sm font-medium text-text-primary hover:bg-border transition-colors min-h-[44px] w-full"
              >
                Connect an account
                <ArrowRight size={14} className="ml-auto text-text-tertiary" />
              </Link>
              <Link
                href="/settings?tab=account"
                className="mt-2 block text-center text-xs text-text-tertiary hover:text-accent-primary"
              >
                Edit profile or voice
              </Link>
            </section>
          )}

          <TodaysPrompt postsSummary={postsSummary} />

          <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
            <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Recent</p>
            {recentActivity.length === 0 ? (
              <p className="mt-3 text-sm text-text-secondary">Draft, schedule, or publish something and it will appear here.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {recentActivity.map((post) => (
                  <li key={post.id} className="flex items-start gap-3">
                    <span
                      className="mt-1 inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getPillarColor(post.pillar) }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{post.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-ink3">{STATUS_LABELS[post.status]} · {formatRelative(post.updated_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricTile({
  value,
  label,
  accent = false,
}: {
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <p className={`font-mono text-2xl font-semibold tabular-nums ${accent ? 'text-flame' : 'text-ink'}`}>{value}</p>
      <p className="mt-1 text-xs text-ink2">{label}</p>
    </div>
  );
}
