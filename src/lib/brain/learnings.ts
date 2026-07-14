import type { BrainGraph } from './graph';

export type LearningKind = 'pillar' | 'timing' | 'platform' | 'voice' | 'engagement';
export type LearningSentiment = 'positive' | 'watch' | 'neutral';

export interface ContentLearning {
  id: string;
  kind: LearningKind;
  /** One-line takeaway, e.g. "Founder lessons is your strongest pillar". */
  headline: string;
  /** Supporting numbers, e.g. "2.3× your median views across 8 posts". */
  detail: string;
  /** Short badge, e.g. "2.3×" or "r=0.5". */
  metric?: string;
  sentiment: LearningSentiment;
  /** Low when the sample is thin — surfaced to the user, never hidden. */
  confidence: 'high' | 'low';
  sampleSize: number;
  /** Graph node ids to highlight when the learning is engaged. */
  nodeIds: string[];
}

/** Minimal shape of a `posts` row needed to mine learnings. */
export interface LearningPost {
  id: string;
  pillar: string | null;
  platform: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows_gained: number | null;
  voice_match_score: number | null;
  posted_date: string | null;
}

// Below MIN_POSTS total we don't claim any learning — the graph falls back to
// the setup-nudge decisions instead of inventing patterns from noise.
const MIN_POSTS = 4;
const MIN_GROUP = 3;
const LIFT = 1.3; // ratio vs median that counts as "outperforming"
const DRAG = 0.6; // ratio vs median that counts as "underperforming"

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ratioLabel(ratio: number): string {
  return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}×`;
}

function groupBy(items: LearningPost[], key: (p: LearningPost) => string | null): Map<string, LearningPost[]> {
  const groups = new Map<string, LearningPost[]>();
  for (const item of items) {
    const k = key(item);
    if (k == null) continue;
    const arr = groups.get(k);
    if (arr) arr.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function pearson(pairs: [number, number][]): number {
  const n = pairs.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? 0 : num / den;
}

/** Resolve the pillar graph-node id for a raw pillar label, if it exists. */
function pillarNodeId(graph: BrainGraph, pillar: string): string | null {
  const key = pillar.trim().toLowerCase();
  const node = graph.nodes.find((n) => n.kind === 'pillar' && n.label.trim().toLowerCase() === key);
  return node?.id ?? null;
}

/** Keep only node ids that actually exist in the graph (some posts aren't synced). */
function presentNodeIds(graph: BrainGraph, ids: (string | null)[]): string[] {
  const present = new Set(graph.nodes.map((n) => n.id));
  return ids.filter((id): id is string => id != null && present.has(id));
}

function postNodeIds(graph: BrainGraph, posts: LearningPost[]): string[] {
  return presentNodeIds(graph, posts.map((p) => `post/${p.id}`));
}

/**
 * Mines content-intelligence learnings from published posts + the brain graph.
 *
 * Every learning is gated on sample size: thin data yields fewer (or zero)
 * learnings and an explicit low-confidence flag, so the surface never fabricates
 * a pattern it can't support.
 */
export function deriveContentLearnings(posts: LearningPost[], graph: BrainGraph): ContentLearning[] {
  const withViews = posts.filter((p) => typeof p.views === 'number' && p.views! >= 0);
  if (withViews.length < MIN_POSTS) return [];

  const learnings: ContentLearning[] = [];
  const overallMedian = median(withViews.map((p) => p.views ?? 0)) || 1;

  // --- Pillar performance ---
  const pillarGroups = Array.from(groupBy(withViews, (p) => p.pillar?.trim() || null).entries()).filter(
    ([, ps]) => ps.length >= MIN_GROUP,
  );
  if (pillarGroups.length >= 2) {
    const ranked = pillarGroups
      .map(([label, ps]) => ({ label, ps, med: median(ps.map((p) => p.views ?? 0)) }))
      .sort((a, b) => b.med - a.med);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    const bestRatio = best.med / overallMedian;
    if (bestRatio >= LIFT) {
      learnings.push({
        id: 'pillar-strong',
        kind: 'pillar',
        headline: `"${best.label}" is your strongest pillar`,
        detail: `${ratioLabel(bestRatio)} your median views across ${best.ps.length} posts. Lean into it.`,
        metric: ratioLabel(bestRatio),
        sentiment: 'positive',
        confidence: best.ps.length >= 5 ? 'high' : 'low',
        sampleSize: best.ps.length,
        nodeIds: presentNodeIds(graph, [pillarNodeId(graph, best.label), ...best.ps.map((p) => `post/${p.id}`)]),
      });
    }
    const worstRatio = worst.med / overallMedian;
    if (worst.label !== best.label && worstRatio <= DRAG) {
      learnings.push({
        id: 'pillar-weak',
        kind: 'pillar',
        headline: `"${worst.label}" is dragging`,
        detail: `Only ${ratioLabel(worstRatio)} your median views across ${worst.ps.length} posts. Rework the angle or retire it.`,
        metric: ratioLabel(worstRatio),
        sentiment: 'watch',
        confidence: worst.ps.length >= 5 ? 'high' : 'low',
        sampleSize: worst.ps.length,
        nodeIds: presentNodeIds(graph, [pillarNodeId(graph, worst.label), ...worst.ps.map((p) => `post/${p.id}`)]),
      });
    }
  }

  // --- Voice-vs-reality: does the voice-match score track real performance? ---
  const voicePairs = withViews
    .filter((p) => typeof p.voice_match_score === 'number')
    .map((p) => [p.voice_match_score as number, p.views as number] as [number, number]);
  if (voicePairs.length >= MIN_POSTS + 1) {
    const r = pearson(voicePairs);
    if (Math.abs(r) >= 0.35) {
      const positive = r > 0;
      learnings.push({
        id: 'voice-reality',
        kind: 'voice',
        headline: positive
          ? 'Your voice is landing'
          : 'High voice-match posts are underperforming',
        detail: positive
          ? `Posts that score higher on voice-match also get more views (r=${r.toFixed(2)}). The model's read of your voice matches your audience.`
          : `Your highest voice-match posts get fewer views (r=${r.toFixed(2)}). The model's idea of "your voice" may be off from what your audience rewards.`,
        metric: `r=${r.toFixed(2)}`,
        sentiment: positive ? 'positive' : 'watch',
        confidence: voicePairs.length >= 10 ? 'high' : 'low',
        sampleSize: voicePairs.length,
        nodeIds: postNodeIds(graph, withViews),
      });
    }
  }

  // --- Timing: best day of week ---
  const byDay = groupBy(withViews, (p) => {
    if (!p.posted_date) return null;
    const day = new Date(`${p.posted_date.slice(0, 10)}T00:00:00Z`).getUTCDay();
    return Number.isNaN(day) ? null : String(day);
  });
  const dayGroups = Array.from(byDay.entries()).filter(([, ps]) => ps.length >= MIN_GROUP);
  const datedCount = Array.from(byDay.values()).reduce((s, ps) => s + ps.length, 0);
  if (dayGroups.length >= 2 && datedCount >= 8) {
    const ranked = dayGroups
      .map(([day, ps]) => ({ day: Number(day), ps, med: median(ps.map((p) => p.views ?? 0)) }))
      .sort((a, b) => b.med - a.med);
    const best = ranked[0];
    const ratio = best.med / overallMedian;
    if (ratio >= LIFT) {
      learnings.push({
        id: 'timing-best-day',
        kind: 'timing',
        headline: `${DAY_NAMES[best.day]} posts perform best`,
        detail: `${ratioLabel(ratio)} your median views across ${best.ps.length} ${DAY_NAMES[best.day]} posts. Schedule more here.`,
        metric: ratioLabel(ratio),
        sentiment: 'positive',
        confidence: best.ps.length >= 5 ? 'high' : 'low',
        sampleSize: best.ps.length,
        nodeIds: postNodeIds(graph, best.ps),
      });
    }
  }

  // --- Platform split ---
  const platformGroups = Array.from(groupBy(withViews, (p) => p.platform?.trim() || null).entries()).filter(
    ([, ps]) => ps.length >= MIN_GROUP,
  );
  if (platformGroups.length >= 2) {
    const ranked = platformGroups
      .map(([label, ps]) => ({ label, ps, med: median(ps.map((p) => p.views ?? 0)) }))
      .sort((a, b) => b.med - a.med);
    const best = ranked[0];
    const ratio = best.med / (median(ranked.slice(1).flatMap((g) => g.ps.map((p) => p.views ?? 0))) || 1);
    if (ratio >= LIFT) {
      learnings.push({
        id: 'platform-best',
        kind: 'platform',
        headline: `${best.label} is your strongest channel`,
        detail: `${ratioLabel(ratio)} the median views of your other platforms across ${best.ps.length} posts.`,
        metric: ratioLabel(ratio),
        sentiment: 'positive',
        confidence: best.ps.length >= 5 ? 'high' : 'low',
        sampleSize: best.ps.length,
        nodeIds: postNodeIds(graph, best.ps),
      });
    }
  }

  // Positive wins first, then things to watch; strongest signal within each.
  const rank: Record<LearningSentiment, number> = { positive: 0, watch: 1, neutral: 2 };
  return learnings.sort((a, b) => rank[a.sentiment] - rank[b.sentiment] || b.sampleSize - a.sampleSize);
}
