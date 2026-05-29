import Link from 'next/link';
import {
  CheckCircle2,
  ArrowRight,
  Link2,
  AlertCircle,
  Circle,
  PenLine,
  Radio,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { getServerClient, getAuthenticatedUser } from '@/lib/insforge/server';
import type { Post, ContentIdea } from '@/lib/types';
import type { Pillar, Priority } from '@/lib/constants';
import { PILLAR_COLORS, STATUS_BADGE, STATUS_LABELS } from '@/lib/constants';

/** Resolve a pillar color with graceful fallback for custom pillars. */
function getPillarColor(pillar: string): string {
  return PILLAR_COLORS[pillar as Pillar] ?? '#78716C';
}
import { formatDateShort, formatRelative } from '@/lib/utils';
import TodaysPrompt from '@/components/dashboard/TodaysPrompt';
import NeedsAttention, { type AttentionItem } from '@/components/dashboard/NeedsAttention';
import { CreatorBrainCard } from '@/components/dashboard/CreatorBrainCard';
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

const PRIORITY_COLORS: Record<Priority, string> = {
  high: '#E07A5F',
  medium: '#F59E0B',
  low: '#5A5047',
};

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
        <h2 className="text-2xl font-semibold text-text-primary mb-2">Welcome to Dispatch</h2>
        <p className="text-[15px] text-text-secondary mb-6 leading-relaxed">
          Write in your voice, schedule posts, and reply to comments — all in one place.
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

  // Fire all queries in parallel
  const [weekPostsRes, pipelineRes, postedRes, streakRes, upNextRes, recentRes, ideasRes, weekScheduleRes, profileRes, socialRes, failedJobsRes, entitlements] =
    await Promise.all([
      client.database.from('posts').select('id').eq('user_id', uid).eq('status', 'posted').gte('posted_date', start).lte('posted_date', end),
      client.database.from('posts').select('id').eq('user_id', uid).neq('status', 'posted').neq('status', 'idea'),
      client.database.from('posts').select('id').eq('user_id', uid).eq('status', 'posted'),
      client.database.from('posts').select('posted_date').eq('user_id', uid).not('posted_date', 'is', null).order('posted_date', { ascending: false }),
      client.database.from('posts').select('*').eq('user_id', uid).gte('scheduled_date', today).neq('status', 'posted').order('scheduled_date', { ascending: true }).limit(3),
      client.database.from('posts').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(5),
      client.database.from('content_ideas').select('*').eq('user_id', uid).eq('converted', false).order('priority', { ascending: true }).limit(3),
      client.database.from('posts').select('title, pillar, status').eq('user_id', uid).gte('scheduled_date', start).lte('scheduled_date', end),
      client.database.from('creator_profile').select('display_name, content_pillars, voice_description, onboarding_complete').eq('user_id', uid).maybeSingle(),
      client.database.from('social_accounts').select('platform, connection_method, health_status').eq('user_id', uid),
      client.database
        .from('publish_jobs')
        .select('id, platform, last_error, status')
        .eq('user_id', uid)
        .in('status', ['failed', 'dead'])
        .order('updated_at', { ascending: false })
        .limit(5),
      getUserEntitlements(uid),
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
  const backlog = (ideasRes.data as ContentIdea[]) ?? [];

  // Setup progress
  const creatorProfile = profileRes.data;
  const connectedPlatforms = (socialRes.data ?? []).map((s: { platform: string }) => s.platform);
  const hasProfile = Boolean(creatorProfile?.display_name && creatorProfile?.content_pillars);
  const hasVoice = Boolean(creatorProfile?.voice_description);
  const hasConnections = connectedPlatforms.length > 0;
  const allPlatforms = ['twitter', 'linkedin', 'instagram', 'threads'];
  const setupComplete = hasProfile && hasVoice && hasConnections;

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
        href: '/settings?tab=connections',
        actionLabel: 'Reconnect',
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-lg border border-border bg-bg-secondary shadow-card overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-badge bg-sage-light px-2.5 py-1 text-xs font-medium text-accent-secondary">
                <Radio className="h-3.5 w-3.5" />
                Workspace live
              </span>
              {!hasConnections && (
                <span className="inline-flex items-center gap-1.5 rounded-badge bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                  <Circle className="h-2 w-2 fill-current" />
                  Publishing not connected
                </span>
              )}
            </div>
            <h1 className="mt-5 max-w-2xl text-[34px] font-semibold leading-tight text-text-primary">
              {creatorProfile?.display_name
                ? `${creatorProfile.display_name.split(' ')[0]}, your content system is ready for the next move.`
                : 'Your content system is ready for the next move.'}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-6 text-text-secondary">
              Draft the next post, schedule the week, or turn replies into leads. Dispatch should feel like a command center, not a folder of half-finished tools.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/generate" className="btn-primary">
                <PenLine className="h-4 w-4" />
                Write next post
              </Link>
              <Link href="/settings?tab=connections" className="btn-secondary">
                <Settings2 className="h-4 w-4" />
                Connect channels
              </Link>
            </div>
          </div>

          <div className="border-t border-border bg-bg-elevated p-6 lg:border-l lg:border-t-0">
            <p className="section-label">This week</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricTile value={postsThisWeek} label="Published" />
              <MetricTile value={inPipeline} label="In progress" />
              <MetricTile value={totalPosted} label="All time" />
              <MetricTile value={streak} label="Day streak" accent />
            </div>
            <div className="mt-5 rounded-lg border border-border bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Creator Brain</p>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">Memory, voice, and shipped posts powering your drafts.</p>
                </div>
                <Sparkles className="h-5 w-5 text-accent-primary" />
              </div>
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
                <p className="section-label">Publishing pipeline</p>
                <h2 className="mt-2 text-lg font-semibold text-text-primary">Coming up</h2>
              </div>
              <Link href="/calendar" className="btn-ghost min-h-[40px] px-3">
                Plan week <ArrowRight size={14} />
              </Link>
            </div>

            {upNext.length === 0 ? (
              <div className="empty-state mt-4">
                <p className="font-medium text-text-primary">No posts are scheduled yet.</p>
                <p className="mt-1">Write one post, choose a platform, then put it on the calendar. That is the fastest path to seeing Dispatch work.</p>
                <Link href="/generate" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-primary">
                  Draft a post <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {upNext.map((post) => (
                  <li key={post.id}>
                    <Link
                      href="/library"
                      className="group flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="inline-block h-9 w-1 rounded-full shrink-0"
                          style={{ backgroundColor: getPillarColor(post.pillar) }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary group-hover:text-accent-primary">{post.title}</p>
                          <p className="mt-0.5 text-xs text-text-tertiary capitalize">{post.platform}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pl-4 sm:pl-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-badge text-xs font-medium ${STATUS_BADGE[post.status]}`}>
                          {STATUS_LABELS[post.status]}
                        </span>
                        {post.scheduled_date && (
                          <span className="text-xs text-text-tertiary">{formatDateShort(post.scheduled_date)}</span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="section-label">Backlog</p>
                <h2 className="mt-2 text-lg font-semibold text-text-primary">Ideas to turn into posts</h2>
              </div>
              <Link href="/ideas" className="btn-ghost min-h-[40px] px-3">
                See all <ArrowRight size={14} />
              </Link>
            </div>
            {backlog.length === 0 ? (
              <div className="empty-state mt-4">
                Capture one sharp idea before you leave. Empty idea backlogs make the next writing session start from zero.
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {backlog.map((idea) => (
                  <li key={idea.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getPillarColor(idea.pillar) }}
                      />
                      <span className="text-sm text-text-primary truncate">{idea.idea}</span>
                    </div>
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-badge text-xs font-medium capitalize shrink-0"
                      style={{
                        backgroundColor: `${PRIORITY_COLORS[idea.priority]}18`,
                        color: PRIORITY_COLORS[idea.priority],
                      }}
                    >
                      {idea.priority}
                    </span>
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
                <h2 className="text-sm font-semibold text-text-primary">Finish setup</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Publishing only feels real after voice, profile, and channels are connected.
              </p>
              <div className="mt-4 space-y-2">
                <SetupStep done={hasProfile} label="Profile saved" href="/settings" />
                <SetupStep done={hasVoice} label="Voice trained" href="/voice-lab" />
                <SetupStep done={hasConnections} label="Channel connected" href="/settings?tab=connections" />
              </div>
            </section>
          )}

          <CreatorBrainCard />

          <TodaysPrompt postsSummary={postsSummary} />

          <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
            <div className="flex items-center justify-between">
              <p className="section-label">Channels</p>
              <Link href="/settings?tab=connections" className="text-xs font-medium text-accent-primary">Manage</Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {allPlatforms.map((p) => {
                const connected = connectedPlatforms.includes(p);
                return (
                  <span
                    key={p}
                    className={`inline-flex items-center justify-between rounded-md border px-3 py-2 text-xs font-medium capitalize ${
                      connected
                        ? 'border-sage/20 bg-sage-light text-accent-secondary'
                        : 'border-border bg-bg-tertiary text-text-tertiary'
                    }`}
                  >
                    {p === 'twitter' ? 'X' : p}
                    <Link2 size={13} />
                  </span>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
            <p className="section-label">Recent activity</p>
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
                      <p className="mt-0.5 text-xs text-text-tertiary">{STATUS_LABELS[post.status]} · {formatRelative(post.updated_at)}</p>
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
      <p className={`text-2xl font-semibold tabular-nums ${accent ? 'text-accent-primary' : 'text-text-primary'}`}>{value}</p>
      <p className="mt-1 text-xs text-text-secondary">{label}</p>
    </div>
  );
}

function SetupStep({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-3 py-3 rounded-md text-sm transition-colors min-h-[44px] ${
        done
          ? 'bg-sage-light text-accent-secondary'
          : 'bg-bg-tertiary text-text-secondary hover:bg-border'
      }`}
    >
      {done ? (
        <CheckCircle2 size={16} className="text-accent-secondary shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full border-2 border-border shrink-0" />
      )}
      <span className={done ? 'line-through opacity-70' : ''}>{label}</span>
      {!done && <ArrowRight size={14} className="ml-auto text-text-tertiary" />}
    </Link>
  );
}
