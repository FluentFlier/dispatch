"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Hash,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Target,
  Users,
  TrendingUp,
  Clock,
  RefreshCw,
} from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { bucketEngagers, type Engager } from "@/lib/hooks-intelligence/categorize";
import AudienceSection, { type AudienceEngagement } from "@/components/analytics/AudienceSection";
import PostPerformanceTable from "@/components/analytics/PostPerformanceTable";
import AnalyticsSectionNav from "@/components/analytics/AnalyticsSectionNav";
import { getInsforge } from "@/lib/insforge/client";
import type { Post, HashtagSet, WeeklyReview } from "@/lib/types";
import { type TimingResult, type TimingWindow } from "@/lib/analytics/timing";
import type { AlgorithmSignal } from "@/lib/analytics/algorithm-insights";
import { countPostsWithMetrics, getPostDisplayTitle, parseLinkedInMetricsPaste } from "@/lib/analytics/post-metrics";
import { usePillars } from "@/hooks/usePillars";
import PillarDot from "@/components/PillarDot";
import { PageHeader } from "@/components/layout/PageHeader";

/* ------------------------------------------------------------------ */
/*  Dynamic recharts imports (prevent SSR issues)                     */
/* ------------------------------------------------------------------ */

import dynamic from "next/dynamic";

// Load the entire charts section as a single dynamic component to avoid SSR
const ChartsSection = dynamic(() => import("@/components/analytics/ChartsSection"), {
  ssr: false,
  loading: () => (
    <div className="space-y-8">
      <div className="h-[300px] bg-bg-tertiary rounded-lg animate-pulse" />
      <div className="h-[300px] bg-bg-tertiary rounded-lg animate-pulse" />
    </div>
  ),
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function truncate(s: string, len: number) {
  return s.length > len ? s.slice(0, len) + "..." : s;
}



/* ------------------------------------------------------------------ */
/*  Main Page Component                                               */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  const { pillars: pillarList, getLabel, getColor } = usePillars();
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>([]);
  const [reviews, setReviews] = useState<WeeklyReview[]>([]);
  const [bestTimes, setBestTimes] = useState<TimingResult | null>(null);
  const [algorithm, setAlgorithm] = useState<AlgorithmPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const autoSynced = useRef(false);

  // === NEW: Consumer Intelligence Surfaces (Hook Lab + Lead Insights) ===
  const [topHooks, setTopHooks] = useState<any[]>([]);
  const [researchResult, setResearchResult] = useState<any>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [hooksLoading, setHooksLoading] = useState(true);

  // Real categorized leads from DB (now that persistence is wired in the closed loop)
  const [realLeadCounts, setRealLeadCounts] = useState<Record<string, number> | null>(null);

  // Reaction breakdown + top commenters from synced engagement
  const [audienceEngagement, setAudienceEngagement] = useState<AudienceEngagement | null>(null);

  const fetchData = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await fetch('/api/analytics', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        setFetchError('Could not load analytics. Try again in a moment.');
        return;
      }
      const data = await res.json();

      setUserId(data.userId ?? null);
      setPosts(data.posts ?? []);
      setHashtagSets(data.hashtagSets ?? []);
      setReviews(data.reviews ?? []);
      setRealLeadCounts(data.leadCounts ?? null);
      setAudienceEngagement(data.engagement ?? null);
      setAlgorithm(data.algorithm ?? null);
      setBestTimes(data.bestTimes ?? null);
    } catch {
      setFetchError('Could not load analytics. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  const runMetricsSync = useCallback(async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/analytics/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMessage((data as { error?: string }).error ?? 'Sync failed. Try again.');
        return;
      }
      const updated = (data as { updated?: number }).updated ?? 0;
      const reason = (data as { reason?: string }).reason;
      setSyncMessage(
        updated > 0
          ? `Synced stats for ${updated} post${updated === 1 ? '' : 's'} from LinkedIn/X/Instagram.`
          : reason
            ? reason
            : 'No new stats from the platforms yet. Log LinkedIn impressions manually above.',
      );
      await fetchData();
    } catch {
      setSyncMessage('Sync failed. Try again.');
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    if (loading || autoSynced.current || posts.length === 0) return;
    const withMetrics = countPostsWithMetrics(posts);
    if (withMetrics < Math.min(3, posts.length)) {
      autoSynced.current = true;
      void runMetricsSync();
    }
  }, [loading, posts, runMetricsSync]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Intelligence surfaces: fetch live RAG hooks + track analytics view (monetization)
  useEffect(() => {
    const loadIntelligence = async () => {
      try {
        // Track this view for usage billing (safe client call)
        try {
          await fetch('/api/analytics', { method: 'POST' }).catch(() => {});
        } catch {}

        const res = await fetch('/api/hooks/intelligence?limit=8');
        if (res.ok) {
          const data = await res.json();
          setTopHooks(data.hooks || []);
        }
      } finally {
        setHooksLoading(false);
      }
    };
    loadIntelligence();
  }, []);

  if (loading) {
    return (
      <div className="space-y-10 pb-20">
        <div className="h-7 w-32 bg-bg-tertiary rounded-md animate-pulse" />
        {/* Log Performance skeleton */}
        <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
          <div className="h-5 w-40 bg-bg-tertiary rounded animate-pulse" />
          <div className="h-10 w-full bg-bg-tertiary rounded-md animate-pulse" />
        </div>
        {/* Performance Overview skeleton */}
        <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
          <div className="h-5 w-48 bg-bg-tertiary rounded animate-pulse" />
          <div className="h-[300px] bg-bg-tertiary rounded-lg animate-pulse" />
        </div>
        {/* Weekly Review skeleton */}
        <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
          <div className="h-5 w-36 bg-bg-tertiary rounded animate-pulse" />
          <div className="h-20 bg-bg-tertiary rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-20">
      <PageHeader eyebrow="ANALYTICS" title="Stats" subtitle="See what’s working and log performance on your posts." />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runMetricsSync()}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-tertiary disabled:opacity-60"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing stats…' : 'Sync stats from platforms'}
        </button>
        {syncMessage && (
          <p className="text-sm text-text-secondary">{syncMessage}</p>
        )}
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex flex-wrap items-center justify-between gap-3">
          <span>{fetchError}</span>
          <button type="button" onClick={() => void fetchData()} className="font-medium underline hover:opacity-80">
            Retry
          </button>
        </div>
      )}

      <AnalyticsSectionNav />

      {/* Section 1 */}
      <div id="performance">
      <LogPerformanceSection posts={posts} userId={userId} onSaved={fetchData} />
      </div>

      <div id="timing">
      <BestTimesSection data={bestTimes} algorithm={algorithm} />
      </div>

      <div id="algorithm-playbook">
      <AlgorithmPlaybookSection algorithm={algorithm} />
      </div>

      <div id="posts-table">
      <PostPerformanceTable posts={posts} />
      </div>

      <div id="charts">
      <ChartsSection posts={posts} getLabel={getLabel} getColor={getColor} />
      </div>

      {/* Hook examples + lead buckets. Full RL training loop is not wired yet. */}
      <section id="intelligence" className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[24px] font-normal tracking-[-0.025em] text-ink flex items-center gap-2.5">
              <Sparkles className="h-5 w-5 text-accent-primary" />
              Hook examples
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              High-performing hook patterns from the local dataset (and any mined hooks). Closed-loop RL training is not live yet.
            </p>
          </div>
          <button
            onClick={async () => {
              setResearchLoading(true);
              try {
                const res = await fetch('/api/research', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ brief: 'improve content performance and lead generation', vertical: 'indie_maker' }),
                });
                const data = await res.json();
                setResearchResult(data);
              } catch (e) {
                setResearchResult({ error: 'Research temporarily unavailable' });
              } finally {
                setResearchLoading(false);
              }
            }}
            disabled={researchLoading}
            className="flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-60 transition-colors"
          >
            {researchLoading ? 'Researching...' : 'Run Fresh Research'}
            <Target className="h-4 w-4" />
          </button>
        </div>

        {/* Hook Lab - Live RAG from our RL-trained dataset */}
        <div className="rounded-xl border border-border bg-bg-secondary p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-coral" />
            <h3 className="font-semibold">Top Performing Hooks (live from intelligence)</h3>
            <span className="text-xs px-2 py-0.5 rounded bg-coral/10 text-coral">RAG + RL ranked</span>
          </div>

          {hooksLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-bg-tertiary rounded-lg animate-pulse" />
              ))}
            </div>
          ) : topHooks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topHooks.slice(0, 8).map((hook, idx) => (
                <div key={idx} className="rounded-lg border border-border/70 bg-bg p-4 hover:border-accent-primary/40 transition-colors group flex flex-col">
                  <div className="text-sm leading-snug text-text-primary line-clamp-3 flex-1">“{hook.text}”</div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <div className="text-text-secondary">@{String(hook.author ?? '').replace(/^@+/, '')} • {hook.verticals?.[0] || 'general'}</div>
                    <div className="text-accent-primary font-semibold">{hook.score}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <CopyButton text={hook.text} className="text-[10px] px-2 py-0.5" />
                    <a href="/generate" className="text-[10px] text-accent-primary hover:underline">Use in Generate</a>
                    <button onClick={async () => {
                      try {
                        const res = await fetch('/api/brain/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: hook.text, type: 'hook', source: 'intelligence' }) });
                        if (!res.ok) throw new Error('save failed');
                        toast('Saved to Creator Brain');
                      } catch { toast('Could not save. Try again.', 'error'); }
                    }} className="text-[10px] text-sage hover:underline">Save to Brain</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-text-secondary py-4">Run research or mining to populate live hooks. Your generated posts will get dramatically better.</div>
          )}

          {researchResult && (
            <div className="mt-4 rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-4 text-sm">
              {researchResult.status === 'hook-context-only' ? (
                <>
                  <div className="font-medium mb-2 flex items-center gap-2">
                    Hook context refreshed
                    <span className="text-xs opacity-70">(local intelligence dataset)</span>
                  </div>
                  <p className="text-xs text-text-secondary mb-2">
                    Surfaced high-performing hook patterns for your brief. Full closed-loop training runs via
                    engagement sync and scheduled intelligence crons.
                  </p>
                </>
              ) : researchResult.error ? (
                <div className="font-medium text-accent-primary">{researchResult.error}</div>
              ) : (
                <div className="font-medium mb-2 flex items-center gap-2">
                  Research complete
                  <span className="text-xs opacity-70">(intelligence updated)</span>
                </div>
              )}
              {researchResult.intelligence?.hooks && (
                <div className="mb-2">
                  <div className="text-xs font-semibold mb-1">Top hooks surfaced:</div>
                  <div className="text-xs bg-bg/50 p-2 rounded max-h-24 overflow-auto">{researchResult.intelligence.hooks.substring(0, 300)}...</div>
                </div>
              )}
              <div className="text-[10px] text-text-tertiary">Use these in Generate, or let crons + engagement sync keep training the model.</div>
            </div>
          )}
        </div>

        {/* Lead Categorization Insights */}
        <div className="rounded-xl border border-border bg-bg-secondary p-6">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-5 w-5 text-sage" />
            <h3 className="font-semibold">Actionable Lead Insights</h3>
            <span className="text-xs px-2 py-0.5 rounded bg-sage/10 text-sage">Not vanity metrics</span>
          </div>

          <p className="text-sm text-text-secondary mb-4">
            Our engagement categorizer buckets every commenter/liker into <strong>ICP • Potential Leads • Community • Other</strong>. This is how you prove your content makes money.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'ICP (Ideal Customers)', count: realLeadCounts?.ICP || 0, color: 'text-coral', desc: 'Founders & decision makers' },
              { label: 'Potential Leads', count: realLeadCounts?.['Potential Lead'] || 0, color: 'text-amber-600', desc: 'Asking questions, high intent' },
              { label: 'Community', count: realLeadCounts?.Community || 0, color: 'text-sage', desc: 'Creators & makers like you' },
              { label: 'Other', count: realLeadCounts?.Other || 0, color: 'text-text-tertiary', desc: 'Casual engagers' },
            ].map((bucket, i) => (
              <div key={i} className="rounded-lg border border-border/60 p-4 bg-bg">
                <div className={`text-3xl font-semibold tabular-nums tracking-tight ${bucket.color}`}>{bucket.count}</div>
                <div className="font-medium text-sm mt-1">{bucket.label}</div>
                <div className="text-[10px] tracking-[0.06em] text-text-tertiary mt-1">{bucket.desc}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 text-xs text-text-tertiary">
            Counts come straight from your categorized engagers. They fill in automatically after each engagement sync, once your published posts start collecting comments.
          </div>
        </div>

        {/* Reaction breakdown + top commenters */}
        <AudienceSection engagement={audienceEngagement} />
      </section>

      <div id="weekly-review">
        <WeeklyReviewSection
          posts={posts}
          reviews={reviews}
          userId={userId}
          onSaved={fetchData}
        />
      </div>

      <div id="hashtags">
        <HashtagVaultSection
          sets={hashtagSets}
          userId={userId}
          onSaved={fetchData}
          pillarList={pillarList}
        />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Best Times To Post                                                */
/* ================================================================== */

interface AlgorithmPanel {
  platform: string;
  model: string;
  signals: AlgorithmSignal[];
  rewards: string[];
  penalties: string[];
  timingHeadline: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  instagram: "Instagram",
  threads: "Threads",
};

function windowSourceLabel(w: TimingWindow): string {
  switch (w.source) {
    case "personal":
      return `${w.sampleSize} of your posts`;
    case "blended":
      return `you + benchmark · ${w.sampleSize} post${w.sampleSize === 1 ? "" : "s"}`;
    case "benchmark":
      return "platform benchmark";
    default: {
      const _exhaustive: never = w.source;
      return _exhaustive;
    }
  }
}

/**
 * Best times to post. Blends the platform algorithm benchmark (how millions of
 * posts perform) with the creator's own results, so a strong recommendation is
 * always available and sharpens as personal data accumulates.
 */
function BestTimesSection({
  data,
  algorithm,
}: {
  data: TimingResult | null;
  algorithm: AlgorithmPanel | null;
}) {
  const platformLabel = algorithm ? PLATFORM_LABEL[algorithm.platform] ?? algorithm.platform : "your platform";
  const basisNote =
    !data || data.basis === "benchmark"
      ? `Based on ${platformLabel} algorithm benchmarks (millions of posts). Will personalize as your posts collect engagement.`
      : data.basis === "blended"
        ? `Blended: ${platformLabel} algorithm benchmarks refined by your ${data.sampleSize} post${data.sampleSize === 1 ? "" : "s"} with engagement.`
        : `Based on your ${data.sampleSize} posts with engagement.`;

  return (
    <section className="bg-bg-secondary border border-border rounded-lg p-6">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">Best times to post</h2>
      </div>

      {algorithm?.timingHeadline && (
        <p className="mt-2 text-sm text-text-primary">{algorithm.timingHeadline}</p>
      )}

      {data && (data.bestWeekdays.length > 0 || data.bestHours.length > 0) ? (
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-text-tertiary">Best days</p>
            <ul className="mt-2 space-y-1.5">
              {data.bestWeekdays.map((w) => (
                <li key={`wd-${w.index}`} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{w.label}</span>
                  <span className="text-text-tertiary text-xs">{windowSourceLabel(w)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-text-tertiary">Best hours</p>
            <ul className="mt-2 space-y-1.5">
              {data.bestHours.map((h) => (
                <li key={`hr-${h.index}`} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{h.label}</span>
                  <span className="text-text-tertiary text-xs">{windowSourceLabel(h)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-secondary">
          Loading recommended windows…
        </p>
      )}

      <p className="mt-4 text-xs text-text-tertiary">{basisNote}</p>
    </section>
  );
}

/* ================================================================== */
/*  Algorithm Playbook                                                */
/* ================================================================== */

/**
 * What the platform's ranking system actually rewards, surfaced as data so the
 * creator (and Content OS generation) optimize for reach, not just readability.
 */
function AlgorithmPlaybookSection({ algorithm }: { algorithm: AlgorithmPanel | null }) {
  if (!algorithm) return null;
  const platformLabel = PLATFORM_LABEL[algorithm.platform] ?? algorithm.platform;

  return (
    <section className="bg-bg-secondary border border-border rounded-lg p-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">{platformLabel} algorithm playbook</h2>
      </div>
      <p className="mt-2 text-sm text-text-secondary">{algorithm.model}</p>

      <div className="mt-4">
        <p className="text-xs font-medium tracking-wide text-text-tertiary">Ranking signals that matter</p>
        <ul className="mt-2 space-y-2">
          {algorithm.signals.map((s) => (
            <li key={s.signal} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-text-primary">{s.signal}</span>
                <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[11px] font-medium text-accent-primary">
                  {s.weight}
                </span>
              </div>
              <p className="text-text-secondary">{s.action}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-emerald-500">Rewards</p>
          <ul className="mt-2 space-y-1.5">
            {algorithm.rewards.map((r) => (
              <li key={r} className="text-sm text-text-secondary">
                + {r}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-red-500">Suppresses reach</p>
          <ul className="mt-2 space-y-1.5">
            {algorithm.penalties.map((p) => (
              <li key={p} className="text-sm text-text-secondary">
                − {p}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 text-xs text-text-tertiary">
        Content OS uses these signals when generating posts so drafts are written to rank, not just to read well.
      </p>
    </section>
  );
}

/* ================================================================== */
/*  SECTION 1: Log Performance                                        */
/* ================================================================== */

function LogPerformanceSection({
  posts,
  userId,
  onSaved,
}: {
  posts: Post[];
  userId: string | null;
  onSaved: () => void;
}) {
  const [selectedPostId, setSelectedPostId] = useState("");
  const [views, setViews] = useState(0);
  const [likes, setLikes] = useState(0);
  const [saves, setSaves] = useState(0);
  const [comments, setComments] = useState(0);
  const [shares, setShares] = useState(0);
  const [followsGained, setFollowsGained] = useState(0);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const post = posts.find((p) => p.id === selectedPostId);
    if (post) {
      setViews(post.views ?? 0);
      setLikes(post.likes ?? 0);
      setSaves(post.saves ?? 0);
      setComments(post.comments ?? 0);
      setShares(post.shares ?? 0);
      setFollowsGained(post.follows_gained ?? 0);
    }
  }, [selectedPostId, posts]);

  async function handleSave() {
    if (!selectedPostId) return;
    setSaving(true);
    setMessage("");
    setSaveError(false);
    try {
      const res = await fetch(`/api/posts/${selectedPostId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          views,
          likes,
          saves,
          comments,
          shares,
          follows_gained: followsGained,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Save failed");
      }
      setMessage("Stats saved successfully!");
      onSaved();
    } catch {
      setSaveError(true);
      setMessage("Failed to save stats. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function handlePasteApply() {
    const parsed = parseLinkedInMetricsPaste(pasteText);
    if (parsed.views !== undefined) setViews(parsed.views);
    if (parsed.likes !== undefined) setLikes(parsed.likes);
    if (parsed.saves !== undefined) setSaves(parsed.saves);
    if (parsed.comments !== undefined) setComments(parsed.comments);
    if (parsed.shares !== undefined) setShares(parsed.shares);
    if (Object.keys(parsed).length > 0) {
      setMessage("Pasted stats applied — review the numbers, then save.");
      setSaveError(false);
    } else {
      setSaveError(true);
      setMessage("Could not read stats from that text. Try copying directly from LinkedIn Analytics.");
    }
  }

  return (
    <section className="bg-bg-secondary border border-border rounded-lg p-6">
      <h2 className="text-[24px] font-normal tracking-[-0.025em] text-ink mb-2 flex items-center gap-2.5">
        <BarChart3 size={20} className="text-ink3" /> Log Performance
      </h2>

      <p className="text-sm text-text-secondary mb-4">
        LinkedIn does not expose post impressions or engagement metrics via their API to third parties.
        Copy your stats from{" "}
        <span className="font-medium text-text-primary">LinkedIn Analytics</span>{" "}
        and paste them here to track performance and train your content intelligence.
      </p>

      <div className="mb-4">
        <label className="block text-sm text-text-secondary mb-1">Select a posted post</label>
        <select
          className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-text-primary"
          value={selectedPostId}
          onChange={(e) => setSelectedPostId(e.target.value)}
        >
          <option value="">-- Choose a post --</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {truncate(getPostDisplayTitle(p), 50)}
            </option>
          ))}
        </select>
      </div>

      {selectedPostId && (
        <>
          <div className="mb-4">
            <label className="block text-sm text-text-secondary mb-1">
              Paste from LinkedIn Analytics <span className="text-text-tertiary">(optional)</span>
            </label>
            <textarea
              className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text-primary min-h-[72px]"
              placeholder="Paste impressions, reactions, comments, etc. from LinkedIn — we&apos;ll fill the fields below."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              type="button"
              onClick={handlePasteApply}
              disabled={!pasteText.trim()}
              className="mt-2 text-sm text-accent-primary hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Apply pasted stats
            </button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-4">
            {[
              { label: "Views", value: views, set: setViews },
              { label: "Likes", value: likes, set: setLikes },
              { label: "Saves", value: saves, set: setSaves },
              { label: "Comments", value: comments, set: setComments },
              { label: "Shares", value: shares, set: setShares },
              { label: "Follows", value: followsGained, set: setFollowsGained },
            ].map((field) => (
              <div key={field.label}>
                <label className="block text-xs text-text-secondary mb-1">
                  {field.label}
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-2 min-h-[44px] text-text-primary"
                  value={field.value}
                  onChange={(e) => field.set(Number(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent-primary text-white px-4 py-2 min-h-[44px] rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            <Save size={16} /> {saving ? "Saving..." : "Save"}
          </button>

          {message && (
            <p className={`mt-2 text-sm ${saveError ? "text-accent-primary" : "text-[#3B6D11]"}`}>
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* Section 2 (PerformanceOverview) extracted to @/components/analytics/ChartsSection */

/* ================================================================== */
/*  SECTION 3: Weekly Review                                          */
/* ================================================================== */

function WeeklyReviewSection({
  posts,
  reviews,
  userId,
  onSaved,
}: {
  posts: Post[];
  reviews: WeeklyReview[];
  userId: string | null;
  onSaved: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [weekStart, setWeekStart] = useState("");
  const [postsPublished, setPostsPublished] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [totalFollowers, setTotalFollowers] = useState(0);
  const [topPostId, setTopPostId] = useState("");
  const [whatWorked, setWhatWorked] = useState("");
  const [doublDown, setDoublDown] = useState("");
  const [whatToCut, setWhatToCut] = useState("");
  const [nextWeek, setNextWeek] = useState("");
  const [aiOutput, setAiOutput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedReview, setExpandedReview] = useState<string | null>(null);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAiOutput("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Here is my weekly content performance data:
- Posts published: ${postsPublished}
- Total views: ${totalViews}
- Total followers gained: ${totalFollowers}
- What worked: ${whatWorked}
- What to double down on: ${doublDown}
- What to cut: ${whatToCut}
- Next week focus: ${nextWeek}

Give me exactly 3 blunt, actionable recommendations for next week. Be direct and specific. No fluff.`,
          systemOverride:
            "You are a blunt content strategist. Give exactly 3 short, specific recommendations. Number them 1-3. No intros or outros.",
        }),
      });
      const data = await res.json();
      setAiOutput(data.text ?? "No response.");
    } catch {
      setAiOutput("Failed to analyze. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSaveReview() {
    if (!userId || !weekStart) return;
    setSaving(true);
    setMessage("");
    try {
      const insforge = getInsforge();
      const { error } = await insforge.database
        .from("weekly_reviews")
        .insert([{
          user_id: userId,
          week_start: weekStart,
          posts_published: postsPublished,
          total_views: totalViews,
          total_followers_gained: totalFollowers,
          top_post_id: topPostId || null,
          what_worked: whatWorked || null,
          what_to_double_down: doublDown || null,
          what_to_cut: whatToCut || null,
          next_week_focus: nextWeek || null,
        }]);
      if (error) throw error;
      setMessage("Review saved!");
      setShowForm(false);
      resetForm();
      onSaved();
    } catch {
      setMessage("Failed to save review.");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setWeekStart("");
    setPostsPublished(0);
    setTotalViews(0);
    setTotalFollowers(0);
    setTopPostId("");
    setWhatWorked("");
    setDoublDown("");
    setWhatToCut("");
    setNextWeek("");
    setAiOutput("");
    setMessage("");
  }

  return (
    <section className="bg-bg-secondary border border-border rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[24px] font-normal tracking-[-0.025em] text-ink flex items-center gap-2.5">
          <Sparkles size={20} className="text-ink3" /> Weekly Review
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-accent-primary text-white px-4 py-2 rounded hover:opacity-90 flex items-center gap-2 text-sm"
          >
            <Plus size={16} /> New Weekly Review
          </button>
        )}
      </div>

      {showForm && (
        <div className="space-y-4 bg-bg-tertiary border border-border rounded-lg p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Week Start</label>
              <input
                type="date"
                className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-text-primary"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Posts Published</label>
              <input
                type="number"
                min={0}
                className="w-24 bg-bg-tertiary border border-border rounded-md px-2 py-1 text-text-primary"
                value={postsPublished}
                onChange={(e) => setPostsPublished(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Total Views</label>
              <input
                type="number"
                min={0}
                className="w-24 bg-bg-tertiary border border-border rounded-md px-2 py-1 text-text-primary"
                value={totalViews}
                onChange={(e) => setTotalViews(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Total Followers Gained</label>
              <input
                type="number"
                min={0}
                className="w-24 bg-bg-tertiary border border-border rounded-md px-2 py-1 text-text-primary"
                value={totalFollowers}
                onChange={(e) => setTotalFollowers(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">Top Post</label>
            <select
              className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-text-primary"
              value={topPostId}
              onChange={(e) => setTopPostId(e.target.value)}
            >
              <option value="">-- Select top post --</option>
              {posts.map((p) => (
                <option key={p.id} value={p.id}>
                  {truncate(p.title, 50)}
                </option>
              ))}
            </select>
          </div>

          {[
            { label: "What Worked", value: whatWorked, set: setWhatWorked },
            { label: "What to Double Down On", value: doublDown, set: setDoublDown },
            { label: "What to Cut", value: whatToCut, set: setWhatToCut },
            { label: "Next Week Focus", value: nextWeek, set: setNextWeek },
          ].map((field) => (
            <div key={field.label}>
              <label className="block text-xs text-text-secondary mb-1">{field.label}</label>
              <textarea
                className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-text-primary text-sm min-h-[60px]"
                value={field.value}
                onChange={(e) => field.set(e.target.value)}
              />
            </div>
          ))}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="bg-[#F59E0B] text-text-primary px-4 py-2 rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2 text-sm font-medium"
            >
              <Sparkles size={16} />{" "}
              {analyzing ? "Analyzing..." : "Analyze My Week"}
            </button>
            <button
              onClick={handleSaveReview}
              disabled={saving || !weekStart}
              className="bg-accent-primary text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2 text-sm"
            >
              <Save size={16} /> {saving ? "Saving..." : "Save Review"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="text-text-secondary hover:text-text-primary px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>

          {aiOutput && (
            <div className="bg-bg-secondary border border-border rounded-lg p-4 mt-2">
              <h4 className="text-sm font-heading text-[#854F0B] mb-2">
                AI Recommendations
              </h4>
              <p className="text-text-primary text-sm whitespace-pre-wrap">
                {aiOutput}
              </p>
            </div>
          )}

          {message && (
            <p className="text-sm text-[#3B6D11]">{message}</p>
          )}
        </div>
      )}

      {/* Past reviews */}
      {reviews.length > 0 && (
        <div className="space-y-2">
          <h3 className="section-label">Past Reviews</h3>
          {reviews.map((r) => {
            const expanded = expandedReview === r.id;
            return (
              <div key={r.id} className="bg-bg-tertiary border border-border rounded-lg">
                <button
                  onClick={() => setExpandedReview(expanded ? null : r.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-text-primary text-sm">
                    Week of{" "}
                    {new Date(r.week_start).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-text-secondary flex items-center gap-2 text-[11px] tracking-[0.02em]">
                    {r.posts_published} posts / {r.total_views} views
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {expanded && (
                  <div className="px-4 pb-4 space-y-2 text-sm">
                    <p className="text-text-secondary">
                      Followers gained:{" "}
                      <span className="text-text-primary">{r.total_followers_gained}</span>
                    </p>
                    {r.what_worked && (
                      <div>
                        <span className="text-text-secondary">What worked: </span>
                        <span className="text-text-primary">{r.what_worked}</span>
                      </div>
                    )}
                    {r.what_to_double_down && (
                      <div>
                        <span className="text-text-secondary">Double down: </span>
                        <span className="text-text-primary">{r.what_to_double_down}</span>
                      </div>
                    )}
                    {r.what_to_cut && (
                      <div>
                        <span className="text-text-secondary">Cut: </span>
                        <span className="text-text-primary">{r.what_to_cut}</span>
                      </div>
                    )}
                    {r.next_week_focus && (
                      <div>
                        <span className="text-text-secondary">Next week focus: </span>
                        <span className="text-text-primary">{r.next_week_focus}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ================================================================== */
/*  SECTION 4: Hashtag Vault                                          */
/* ================================================================== */

function HashtagVaultSection({
  sets,
  userId,
  onSaved,
  pillarList,
}: {
  sets: HashtagSet[];
  userId: string | null;
  onSaved: () => void;
  pillarList: { value: string; label: string }[];
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [pillar, setPillar] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [analyzeOutput, setAnalyzeOutput] = useState<Record<string, string>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEdit(set: HashtagSet) {
    setEditingId(set.id);
    setName(set.name);
    setTags(set.tags);
    setPillar(set.pillar ?? "");
    setShowCreate(false);
  }

  function resetForm() {
    setName("");
    setTags("");
    setPillar("");
    setEditingId(null);
    setShowCreate(false);
    setMessage("");
  }

  async function handleSave() {
    if (!userId || !name.trim() || !tags.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const insforge = getInsforge();
      const payload = {
        name: name.trim(),
        tags: tags.trim(),
        pillar: pillar || null,
      };

      if (editingId) {
        const { error } = await insforge.database
          .from("hashtag_sets")
          .update(payload)
          .eq("id", editingId)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await insforge.database
          .from("hashtag_sets")
          .insert([{ ...payload, user_id: userId, use_count: 0 }]);
        if (error) throw error;
      }

      setMessage(editingId ? "Set updated!" : "Set created!");
      resetForm();
      onSaved();
    } catch {
      setMessage("Failed to save hashtag set.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!userId) return;
    try {
      const insforge = getInsforge();
      await insforge.database
        .from("hashtag_sets")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);
      setConfirmDeleteId(null);
      onSaved();
    } catch {
      /* silent */
    }
  }

  async function handleCopy(tagsStr: string, id: string) {
    await navigator.clipboard.writeText(tagsStr);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function handleAnalyze(set: HashtagSet) {
    setAnalyzingId(set.id);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Analyze these hashtags for an Instagram content creator:
Set name: "${set.name}"
Tags: ${set.tags}
Pillar: ${set.pillar ?? "general"}

Which tags should I keep and which should I cut? Be specific and blunt. Suggest 2-3 replacements for any tags you recommend cutting.`,
          systemOverride:
            "You are a blunt social media strategist. Analyze hashtags and say which to keep and which to cut. Be specific. Suggest replacements.",
        }),
      });
      const data = await res.json();
      setAnalyzeOutput((prev) => ({ ...prev, [set.id]: data.text ?? "" }));
    } catch {
      setAnalyzeOutput((prev) => ({
        ...prev,
        [set.id]: "Failed to analyze.",
      }));
    } finally {
      setAnalyzingId(null);
    }
  }

  return (
    <section className="bg-bg-secondary border border-border rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[24px] font-normal tracking-[-0.025em] text-ink flex items-center gap-2.5">
          <Hash size={20} className="text-ink3" /> Hashtag Vault
        </h2>
        {!showCreate && !editingId && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-accent-primary text-white px-4 py-2 rounded hover:opacity-90 flex items-center gap-2 text-sm"
          >
            <Plus size={16} /> Create Set
          </button>
        )}
      </div>

      {/* Create / Edit form */}
      {(showCreate || editingId) && (
        <div className="bg-bg-tertiary border border-border rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Name</label>
            <input
              className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-text-primary text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Founder hashtags"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              Tags (space or comma separated)
            </label>
            <textarea
              className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-text-primary text-sm min-h-[60px]"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="#founder #startup #buildinpublic"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Pillar (optional)</label>
            <select
              className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-text-primary text-sm"
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
            >
              <option value="">-- None --</option>
              {pillarList.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !tags.trim()}
              className="bg-accent-primary text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2 text-sm"
            >
              <Save size={16} />{" "}
              {saving ? "Saving..." : editingId ? "Update Set" : "Create Set"}
            </button>
            <button
              onClick={resetForm}
              className="text-text-secondary hover:text-text-primary px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
          {message && <p className="text-sm text-[#3B6D11]">{message}</p>}
        </div>
      )}

      {/* List */}
      {sets.length === 0 && !showCreate && (
        <p className="text-text-secondary text-sm">
          No hashtag sets yet. Create one to get started.
        </p>
      )}

      <div className="space-y-3">
        {sets.map((s) => (
          <div key={s.id} className="bg-bg-tertiary border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-text-primary text-sm font-medium truncate">
                  {s.name}
                </span>
                {s.pillar && <PillarDot pillar={s.pillar} showLabel />}
                <span className="text-text-secondary text-xs shrink-0">
                  Used {s.use_count}x
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleCopy(s.tags, s.id)}
                  className="text-text-secondary hover:text-text-primary p-1.5 rounded-md"
                  title="Copy tags"
                >
                  <ClipboardCopy size={14} />
                </button>
                <button
                  onClick={() => handleAnalyze(s)}
                  disabled={analyzingId === s.id}
                  className="text-text-secondary hover:text-[#854F0B] p-1.5 rounded-md disabled:opacity-50"
                  title="Analyze"
                >
                  <Sparkles size={14} />
                </button>
                <button
                  onClick={() => startEdit(s)}
                  className="text-text-secondary hover:text-text-primary p-1.5 rounded-md"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setConfirmDeleteId(s.id)}
                  className="text-text-secondary hover:text-accent-primary p-1.5 rounded-md"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {confirmDeleteId === s.id && (
              <div className="flex items-center gap-2 mt-2 text-xs">
                <span className="text-text-secondary">Delete this set?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete(s.id)}
                  className="text-accent-primary font-medium hover:underline"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-text-secondary hover:underline"
                >
                  Cancel
                </button>
              </div>
            )}
            <p className="text-text-secondary text-xs truncate">{s.tags}</p>
            {copiedId === s.id && (
              <p className="text-xs text-[#3B6D11]">Copied!</p>
            )}
            {analyzeOutput[s.id] && (
              <div className="bg-bg-secondary border border-border rounded-lg p-3 mt-2">
                <h4 className="text-xs font-heading text-[#854F0B] mb-1">Analysis</h4>
                <p className="text-text-primary text-xs whitespace-pre-wrap">
                  {analyzeOutput[s.id]}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
