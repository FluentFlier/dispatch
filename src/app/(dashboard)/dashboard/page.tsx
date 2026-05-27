import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  CalendarClock,
  Layers,
  CheckCircle2,
  Flame,
  ArrowRight,
  Link2,
  AlertCircle,
} from 'lucide-react';
import { getServerClient, getAuthenticatedUser } from '@/lib/insforge/server';
import type { Post, ContentIdea } from '@/lib/types';
import type { Pillar, Priority, Status } from '@/lib/constants';
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
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="pt-1">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {creatorProfile?.display_name
            ? `Hi, ${creatorProfile.display_name.split(' ')[0]}`
            : 'Home'}
        </h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          What would you like to do today?
        </p>
      </header>

      <QuickActions />

      <NeedsAttention items={attentionItems} />

      <CreatorBrainCard />

      {/* Setup checklist -- only show if setup is incomplete */}
      {!setupComplete && (
        <section className="rounded-lg border border-border bg-bg-secondary p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-accent-primary shrink-0" />
            <span className="text-sm font-medium text-text-primary">Finish setup to publish</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <SetupStep done={hasProfile} label="Set up profile" href="/settings" />
            <SetupStep done={hasVoice} label="Define your voice" href="/voice-lab" />
            <SetupStep done={hasConnections} label="Connect a platform" href="/settings" />
          </div>
        </section>
      )}

      {/* Connection status */}
      {hasConnections && (
        <div className="flex items-center gap-2 flex-wrap">
          <Link2 size={14} className="text-text-tertiary" />
          {allPlatforms.map((p) => {
            const connected = connectedPlatforms.includes(p);
            return (
              <span
                key={p}
                className={`text-xs font-medium px-2.5 py-1 rounded-badge capitalize ${
                  connected
                    ? 'bg-sage-light text-accent-secondary'
                    : 'bg-bg-tertiary text-text-tertiary'
                }`}
              >
                {p === 'twitter' ? 'X' : p}
              </span>
            );
          })}
          {connectedPlatforms.length < 4 && (
            <Link href="/settings" className="text-xs text-accent-primary hover:text-accent-dark font-medium">
              + connect more
            </Link>
          )}
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={CalendarClock} value={postsThisWeek} label="Posts this week" accent={false} />
        <StatCard icon={Layers} value={inPipeline} label="In pipeline" accent={false} />
        <StatCard icon={CheckCircle2} value={totalPosted} label="Total posted" accent={false} />
        <StatCard icon={Flame} value={streak} label="Day streak" accent />
      </div>

      {/* Middle row: Up Next + Today's Prompt */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Up Next */}
        <section className="rounded-lg border border-border bg-bg-secondary p-4 shadow-card">
          <SectionLabel>Coming up</SectionLabel>
          {upNext.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing scheduled yet.</p>
          ) : (
            <ul className="space-y-2">
              {upNext.map((post) => (
                <li key={post.id}>
                  <Link
                    href="/library"
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 group min-h-[44px] py-2 px-2 -mx-2 rounded-md hover:bg-bg-tertiary transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="inline-block w-1 h-8 rounded-full shrink-0"
                        style={{ backgroundColor: getPillarColor(post.pillar) }}
                      />
                      <span className="text-sm font-medium text-text-primary truncate group-hover:text-accent-primary transition-colors">
                        {post.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4 sm:ml-0">
                      <span className="text-xs text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded-badge capitalize">
                        {post.platform}
                      </span>
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

        {/* Today's Prompt (Client Component) */}
        <TodaysPrompt postsSummary={postsSummary} />
      </div>

      {/* Backlog */}
      <section className="rounded-lg border border-border bg-bg-secondary p-4 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <SectionLabel className="mb-0">Ideas to write</SectionLabel>
          <Link href="/ideas" className="text-xs text-accent-primary hover:text-accent-dark font-medium flex items-center gap-1 min-h-[44px]">
            See all <ArrowRight size={14} />
          </Link>
        </div>
        {backlog.length === 0 ? (
          <p className="text-sm text-text-secondary">No ideas saved yet.</p>
        ) : (
          <ul className="space-y-2">
            {backlog.map((idea) => (
              <li key={idea.id} className="flex items-center justify-between gap-3 py-1">
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

      {/* Recent Activity */}
      <section className="rounded-lg border border-border bg-bg-secondary p-4 shadow-card">
        <SectionLabel>Recent</SectionLabel>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-text-secondary">Your latest posts will show here.</p>
        ) : (
          <ul className="space-y-2">
            {recentActivity.map((post) => (
              <li key={post.id} className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: getPillarColor(post.pillar) }}
                  />
                  <span className="text-sm text-text-primary truncate">{post.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-badge text-xs font-medium ${STATUS_BADGE[post.status]}`}>
                    {STATUS_LABELS[post.status]}
                  </span>
                  <span className="text-xs text-text-tertiary">{formatRelative(post.updated_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3 ${className}`}>
      {children}
    </p>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  accent = false,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 shadow-card">
      <div className="flex items-center gap-3 mb-1">
        <Icon size={18} className="text-text-tertiary" />
        <span className={`text-2xl font-semibold ${accent ? 'text-accent-primary' : 'text-text-primary'}`}>{value}</span>
      </div>
      <p className="text-xs text-text-secondary">{label}</p>
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
