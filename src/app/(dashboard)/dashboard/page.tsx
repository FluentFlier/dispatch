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
import { getActiveWorkspaceId } from '@/lib/workspace';

/** Resolve a pillar color with graceful fallback for custom pillars. */
function getPillarColor(pillar: string): string {
  return PILLAR_COLORS[pillar as Pillar] ?? '#78716C';
}
import { formatDateShort, formatRelative } from '@/lib/utils';
import TodaysPrompt from '@/components/dashboard/TodaysPrompt';
import NeedsAttention, { type AttentionItem } from '@/components/dashboard/NeedsAttention';
import { CreatorBrainCard } from '@/components/dashboard/CreatorBrainCard';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { MorningBriefCard } from '@/components/dashboard/MorningBriefCard';
import { GtmCommandCenter } from '@/components/dashboard/GtmCommandCenter';
import { getUserEntitlements } from '@/lib/entitlements';
import { SectionHeader } from '@/components/layout/SectionHeader';
import CalendarConnectionCard from '@/components/calendar/CalendarConnectionCard';
import {
  composeMorningBrief,
  type TrendRow,
  type BriefPostRow,
} from '@/lib/rituals/morning-brief';

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
        <span className="inline-flex items-center gap-2 rounded-full border border-hair bg-white/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink2 shadow-sm backdrop-blur-sm mb-4">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue" aria-hidden />
          Content OS
        </span>
        <h2 className="text-[clamp(28px,3.5vw,36px)] font-semibold tracking-[-0.03em] leading-tight text-ink mb-2">Welcome to Content OS</h2>
        <p className="text-[15px] text-ink2 mb-6 leading-relaxed">
          Write in your voice, schedule posts, and reply to comments, all in one place.
        </p>
        <a href="/generate" className="btn-primary">
          Write your first post
        </a>
      </div>
    );
  }

  const client = getServerClient();
  const { start, end } = getWeekBounds();
  const today = new Date().toISOString().slice(0, 10);
  // Two-day lookback so the morning brief can isolate "yesterday" regardless of tz.
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const workspaceId = await getActiveWorkspaceId(uid);
  // Scope content queries to the active workspace (rows are backfilled).
  // creator_profile stays user-scoped until per-workspace voice ships.
  const scoped = <T,>(q: T): T => (workspaceId ? (q as { eq: (c: string, v: string) => T }).eq('workspace_id', workspaceId) : q);

  // Fire all queries in parallel
  const [weekPostsRes, pipelineRes, postedRes, streakRes, upNextRes, recentRes, ideasRes, weekScheduleRes, profileRes, socialRes, failedJobsRes, entitlements, trendsRes, yesterdayPostsRes] =
    await Promise.all([
      scoped(client.database.from('posts').select('id').eq('user_id', uid).eq('status', 'posted').gte('posted_date', start).lte('posted_date', end)),
      scoped(client.database.from('posts').select('id').eq('user_id', uid).neq('status', 'posted').neq('status', 'idea')),
      scoped(client.database.from('posts').select('id').eq('user_id', uid).eq('status', 'posted')),
      scoped(client.database.from('posts').select('posted_date').eq('user_id', uid).not('posted_date', 'is', null).order('posted_date', { ascending: false })),
      scoped(client.database.from('posts').select('*').eq('user_id', uid).gte('scheduled_date', today).neq('status', 'posted').order('scheduled_date', { ascending: true }).limit(3)),
      scoped(client.database.from('posts').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(5)),
      scoped(client.database.from('content_ideas').select('*').eq('user_id', uid).eq('converted', false).order('priority', { ascending: true }).limit(3)),
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
      // Morning brief: recent trends (detected_trends is user-scoped, no workspace col)
      client.database.from('detected_trends')
        .select('topic, angle, draft_hook, best_platform, urgency, confidence, detected_at')
        .eq('user_id', uid)
        .order('detected_at', { ascending: false })
        .limit(8),
      // Morning brief: posted content from the last two days for the "yesterday" summary
      scoped(client.database.from('posts')
        .select('title, posted_date, views, saves')
        .eq('user_id', uid)
        .eq('status', 'posted')
        .gte('posted_date', twoDaysAgo)
        .order('posted_date', { ascending: false })
        .limit(20)),
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

  // Compose the morning brief from already-fetched rows — zero extra AI/DB cost.
  const morningBrief = composeMorningBrief({
    now: new Date(),
    trends: (trendsRes.data as TrendRow[]) ?? [],
    recentPosts: (yesterdayPostsRes.data as BriefPostRow[]) ?? [],
    ideas: backlog.map((i) => ({ id: i.id, idea: i.idea, pillar: i.pillar })),
  });

  // Setup progress
  const creatorProfile = profileRes.data;
  const connectedPlatforms = (socialRes.data ?? []).map((s: { platform: string }) => s.platform);
  const hasProfile = Boolean(creatorProfile?.display_name && creatorProfile?.content_pillars);
  const hasVoice = Boolean(creatorProfile?.voice_description);
  const hasConnections = connectedPlatforms.length > 0;
  const allPlatforms = ['twitter', 'linkedin'] as const;
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
    <div className="page-shell-wide">
      <section className="card-surface overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="p-6 md:p-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-hair bg-white/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink2 shadow-sm backdrop-blur-sm">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue shadow-[0_0_8px_#2563EB]" aria-hidden />
              Dashboard
            </span>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal/20 bg-teal/10 px-3 py-1 text-xs font-medium text-teal">
                <Radio className="h-3.5 w-3.5" />
                Workspace live
              </span>
              {!hasConnections && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-flame/20 bg-flame/10 px-3 py-1 text-xs font-medium text-flame">
                  <Circle className="h-2 w-2 fill-current" />
                  Publishing not connected
                </span>
              )}
            </div>
            <h1 className="mt-5 max-w-2xl text-[clamp(32px,4vw,44px)] font-semibold leading-[1.05] tracking-[-0.04em] text-ink">
              {creatorProfile?.display_name
                ? `${creatorProfile.display_name.split(' ')[0]}, your content system is ready for the next move.`
                : 'Your content system is ready for the next move.'}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-6 text-ink2">
              Draft the next post, schedule the week, or turn replies into leads. Content OS should feel like a command center, not a folder of half-finished tools.
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

          <div className="border-t border-hair bg-paper2/50 p-6 lg:border-l lg:border-t-0">
            <p className="section-label">This week</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricTile value={postsThisWeek} label="Published" />
              <MetricTile value={inPipeline} label="In progress" />
              <MetricTile value={totalPosted} label="All time" />
              <MetricTile value={streak} label="Day streak" accent />
            </div>
            <div className="mt-5 rounded-2xl border border-hair bg-white/80 p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Creator Brain</p>
                  <p className="mt-1 text-xs leading-5 text-ink2">Memory, voice, and shipped posts powering your drafts.</p>
                </div>
                <Sparkles className="h-5 w-5 text-blue" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <QuickActions />

      <GtmCommandCenter />

      <MorningBriefCard brief={morningBrief} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <NeedsAttention items={attentionItems} />

          <section className="card-surface p-5">
            <SectionHeader
              tag="Publishing pipeline"
              title="Coming up"
              accent="#2563EB"
              action={
                <Link href="/calendar" className="btn-ghost min-h-[40px] px-3">
                  Plan week <ArrowRight size={14} />
                </Link>
              }
            />

            {upNext.length === 0 ? (
              <div className="empty-state mt-4">
                <p className="font-medium text-ink">No posts are scheduled yet.</p>
                <p className="mt-1">Write one post, choose a platform, then put it on the calendar. That is the fastest path to seeing Content OS work.</p>
                <Link href="/generate" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue">
                  Draft a post <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-hair">
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
                          <p className="truncate text-sm font-medium text-ink group-hover:text-blue">{post.title}</p>
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

          <section className="card-surface p-5">
            <SectionHeader
              tag="Backlog"
              title="Ideas to turn into posts"
              accent="#0D9488"
              action={
                <Link href="/ideas" className="btn-ghost min-h-[40px] px-3">
                  See all <ArrowRight size={14} />
                </Link>
              }
            />
            {backlog.length === 0 ? (
              <div className="empty-state mt-4">
                Capture one sharp idea before you leave. Empty idea backlogs make the next writing session start from zero.
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-hair">
                {backlog.map((idea) => (
                  <li key={idea.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getPillarColor(idea.pillar) }}
                      />
                      <span className="text-sm text-ink truncate">{idea.idea}</span>
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
            <section className="card-surface p-5">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-blue shrink-0" />
                <h2 className="text-sm font-semibold text-ink">Finish setup</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink2">
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

          <section className="card-surface p-5">
            <div className="flex items-center justify-between">
              <p className="section-label">Channels</p>
              <Link href="/settings?tab=connections" className="text-xs font-medium text-blue">Manage</Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {allPlatforms.map((p) => {
                const connected = connectedPlatforms.includes(p);
                return (
                  <span
                    key={p}
                    className={`inline-flex items-center justify-between rounded-full border px-3 py-2 text-xs font-medium capitalize ${
                      connected
                        ? 'border-teal/20 bg-teal/10 text-teal'
                        : 'border-hair bg-paper2 text-ink3'
                    }`}
                  >
                    {p === 'twitter' ? 'X' : 'LinkedIn'}
                    <Link2 size={13} />
                  </span>
                );
              })}
            </div>
          </section>

          <section className="card-surface p-5">
            <p className="section-label mb-3">Calendar</p>
            <CalendarConnectionCard />
          </section>

          <section className="card-surface p-5">
            <p className="section-label">Recent activity</p>
            {recentActivity.length === 0 ? (
              <p className="mt-3 text-sm text-ink2">Draft, schedule, or publish something and it will appear here.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {recentActivity.map((post) => (
                  <li key={post.id} className="flex items-start gap-3">
                    <span
                      className="mt-1 inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getPillarColor(post.pillar) }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{post.title}</p>
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
    <div className="rounded-2xl border border-hair bg-white/80 p-3 backdrop-blur-sm">
      <p className={`font-mono text-2xl font-semibold tabular-nums ${accent ? 'text-flame' : 'text-ink'}`}>{value}</p>
      <p className="mt-1 text-xs text-ink2">{label}</p>
    </div>
  );
}

function SetupStep({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-3 py-3 rounded-full text-sm transition-colors min-h-[44px] ${
        done
          ? 'bg-teal/10 text-teal'
          : 'bg-paper2 text-ink2 hover:bg-hair/30'
      }`}
    >
      {done ? (
        <CheckCircle2 size={16} className="text-teal shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full border-2 border-hair shrink-0" />
      )}
      <span className={done ? 'line-through opacity-70' : ''}>{label}</span>
      {!done && <ArrowRight size={14} className="ml-auto text-ink3" />}
    </Link>
  );
}
