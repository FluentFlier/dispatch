/**
 * Niche hook mining (spec 2.3), generalized from prod-mining.ts.
 * Source: Apify no-cookie actor (env HOOKS_MINING_ACTOR, default
 * apimaestro/linkedin-posts-search-scraper-no-cookies). We NEVER scrape with a
 * user/tenant LinkedIn session (spec 0.4). Ingest is a cheapest-first 7-stage
 * filter chain; every rejection is counted per reason so the funnel is auditable.
 *
 * BUDGET: mineNiche never reads HOOKS_MINING_WEEKLY_CAP_USD itself - the caller
 * (Task 8's weekly cron) is the one place that knows total spend-to-date, so it
 * computes opts.maxResults from the remaining budget and reads back costUsd to
 * update its running total. Keeping the cap out of this file means one spend
 * ledger instead of two that can drift.
 *
 * CONTRACT: aiTextLikelihood (src/lib/huggingface.ts) returns
 * { score, detector: 'desklib' | 'heuristic' }, not a bare number (desklib is
 * currently broken on HF hosting, so heuristic-only is today's live reality).
 * Filter 4 rejects on score alone regardless of detector, but every score's
 * detector is tallied into aiDetectorCounts so a heuristic-only run is visible
 * in the summary instead of silently passing as if desklib ran.
 */
import type { createClient } from '@insforge/sdk';
import { ApifyClient } from 'apify-client';
import { chatCompletion } from '@/lib/llm';
import { resolveModel } from '@/lib/ai-tiers';
import { parseLlmJson } from '@/lib/llm-json';
import { aiTextLikelihood } from '@/lib/huggingface';
import { embedBatch, toPgVector } from '@/lib/embeddings';
import { priorAlpha } from './thompson';
import { runChecks } from '@/lib/content-pipeline/checks';
import { cosineSim } from './niche-resolver';

type InsforgeClient = ReturnType<typeof createClient>;

const APIFY_ACTOR = process.env.HOOKS_MINING_ACTOR || 'apimaestro/linkedin-posts-search-scraper-no-cookies';
const COST_PER_RESULT_USD = 0.005; // $5 / 1k results (spec 2.3)
const AI_REJECT_ABOVE = 0.8;
const FIT_REJECT_BELOW = 6;
const NEAR_DUP_COSINE = 0.92;

export interface RawPost {
  text: string;
  likes: number;
  comments: number;
  followers: number;
  author: string;
  url?: string;
  createdAt?: string;
}

export interface RejectionCounts {
  structure: number;
  bait: number;
  engagement: number;
  ai: number;
  fit: number;
  nearDup: number;
}

export interface MiningResult {
  accepted: number;
  costUsd: number;
  rejections: RejectionCounts;
  /** Per-detector tally for filter 4, so a heuristic-only run is observable. */
  aiDetectorCounts: { desklib: number; heuristic: number };
}

/** Filter 1: has a real first line and length in [30, 3000]. */
export function passesStructure(text: string): boolean {
  const t = text.trim();
  if (t.length < 30 || t.length > 3000) return false;
  const firstLine = t.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 0;
}

/** Filter 3: log-normalized engagement, comments weighted 3x (pod-fake resistant). */
export function normEngagement(likes: number, comments: number, followers: number): number {
  return Math.log(1 + likes + 3 * comments) - Math.log(1 + followers);
}

/** Fraction of the batch a value is >= (0..1). */
export function percentileRank(value: number, values: number[]): number {
  if (values.length === 0) return 1;
  const atOrBelow = values.filter((v) => v <= value).length;
  return atOrBelow / values.length;
}

/**
 * First line of a post, minus trailing sentence punctuation and stray quotes.
 * When the post has no newline, falls back to the first sentence (split on
 * '. '/'! '/'? ' boundaries) rather than treating the whole blob as one line -
 * otherwise a single-paragraph post never gets the sentence split.
 */
export function extractOpener(text: string): string {
  const trimmed = text.trim();
  const hasNewline = trimmed.includes('\n');
  const firstLine = trimmed.split('\n')[0]?.trim() ?? '';
  const base = hasNewline ? firstLine : (trimmed.split(/(?<=[.!?])\s+/)[0] ?? firstLine);
  // Strip a run of trailing . ! ? and ellipsis, but keep interior punctuation.
  return base.replace(/[.!?…]+$/g, '').trimEnd();
}

/** Index of the first existing embedding within cosine >= threshold, else -1. */
export function nearDupIndex(vec: number[], existing: number[][], threshold = NEAR_DUP_COSINE): number {
  for (let i = 0; i < existing.length; i++) {
    if (cosineSim(vec, existing[i]) >= threshold) return i;
  }
  return -1;
}

/** Pulls posts for a niche's seed keywords from the Apify no-cookie actor. */
async function fetchRawPosts(apify: ApifyClient, seedKeywords: string[], maxResults: number): Promise<RawPost[]> {
  const run = await apify.actor(APIFY_ACTOR).call({
    keywords: seedKeywords,
    maxResults,
    datePosted: 'past-month',
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  return (items as Array<Record<string, unknown>>).map((it) => ({
    text: String(it.text ?? it.postText ?? it.content ?? '').trim(),
    likes: Number(it.likes ?? it.numLikes ?? it.reactionsCount ?? 0),
    comments: Number(it.comments ?? it.numComments ?? it.commentsCount ?? 0),
    followers: Number(it.authorFollowers ?? it.followers ?? 0),
    author: String((it.author as { name?: string })?.name ?? it.authorName ?? 'unknown'),
    url: it.url ? String(it.url) : undefined,
    createdAt: it.postedAt ? String(it.postedAt) : undefined,
  }));
}

/** LLM batch extraction: opener, pattern_class, and niche-fit 0-10 (cheap tier). */
async function classifyBatch(
  posts: RawPost[],
  nicheLabel: string,
): Promise<Array<{ pattern_class: string; fit: number }>> {
  const system =
    'For each LinkedIn post, return JSON {"results":[{"pattern_class": one of ' +
    '["contrarian","number_result","story_open","question","how_to","bait","other"], ' +
    '"fit": integer 0-10 how well it fits the niche}]}. Order matches input. No prose.';
  const user = JSON.stringify({ niche: nicheLabel, posts: posts.map((p) => extractOpener(p.text)) });
  const raw = await chatCompletion(system, user, {
    model: resolveModel('fast'),
    temperature: 0,
    responseFormat: 'json',
    maxTokens: 1200,
  });
  const parsed = parseLlmJson<{ results?: Array<{ pattern_class?: string; fit?: number }> }>(raw) ?? {};
  return posts.map((_, i) => ({
    pattern_class: parsed.results?.[i]?.pattern_class ?? 'other',
    fit: Number(parsed.results?.[i]?.fit ?? 0),
  }));
}

/**
 * Mines one niche end to end. maxResults is derived from the caller's remaining
 * budget so this never overspends. Returns the accept count, actual scrape cost,
 * and per-stage rejection counts.
 */
export async function mineNiche(
  client: InsforgeClient,
  niche: { id: string; label: string; seed_keywords: string[] },
  opts: { maxResults?: number },
): Promise<MiningResult> {
  const rejections: RejectionCounts = { structure: 0, bait: 0, engagement: 0, ai: 0, fit: 0, nearDup: 0 };
  const aiDetectorCounts = { desklib: 0, heuristic: 0 };
  const token = process.env.APIFY_TOKEN;
  if (!token || niche.seed_keywords.length === 0) {
    return { accepted: 0, costUsd: 0, rejections, aiDetectorCounts };
  }
  const apify = new ApifyClient({ token });
  const maxResults = Math.max(0, Math.min(opts.maxResults ?? 200, 200));
  const raw = await fetchRawPosts(apify, niche.seed_keywords, maxResults);
  const costUsd = raw.length * COST_PER_RESULT_USD;

  // Filter 1: structure.
  let posts = raw.filter((p) => { const ok = passesStructure(p.text); if (!ok) rejections.structure++; return ok; });

  // Filter 2: bait_hook from the Phase 1 registry (never learn suppressed patterns).
  posts = posts.filter((p) => {
    const bait = runChecks(p.text, { contentType: 'post', platform: 'linkedin', userPrompt: '' })
      .find((r) => r.id === 'bait_hook');
    const ok = !bait || bait.pass;
    if (!ok) rejections.bait++;
    return ok;
  });

  // Filter 3: engagement normalization, drop bottom quartile within batch.
  const normed = posts.map((p) => ({ p, ne: normEngagement(p.likes, p.comments, p.followers) }));
  const neValues = normed.map((x) => x.ne);
  posts = normed.filter((x) => {
    const ok = percentileRank(x.ne, neValues) > 0.25;
    if (!ok) rejections.engagement++;
    return ok;
  }).map((x) => x.p);

  // Filter 4: AI-likelihood gate, reject > 0.8 regardless of which detector produced
  // the score (desklib vs heuristic fallback) - the gate policy doesn't change,
  // but every score's provenance is tallied so a heuristic-only run stays visible.
  const aiResults = await Promise.all(posts.map((p) => aiTextLikelihood(p.text)));
  for (const r of aiResults) aiDetectorCounts[r.detector]++;
  posts = posts.filter((_, i) => { const ok = aiResults[i].score <= AI_REJECT_ABOVE; if (!ok) rejections.ai++; return ok; });
  const aiScores = aiResults.map((r) => r.score);

  // Filter 5: LLM pattern_class + niche fit, reject fit < 6.
  if (posts.length === 0) return { accepted: 0, costUsd, rejections, aiDetectorCounts };
  const classes = await classifyBatch(posts, niche.label);
  const kept = posts
    .map((p, i) => ({ p, ai: aiScores[i], ...classes[i] }))
    .filter((x) => {
      if (x.pattern_class === 'bait') { rejections.bait++; return false; } // belt-and-suspenders
      const ok = x.fit >= FIT_REJECT_BELOW;
      if (!ok) rejections.fit++;
      return ok;
    });

  // Filter 6: embed + near-dup (cosine >= 0.92) against this niche's existing hooks.
  if (kept.length === 0) return { accepted: 0, costUsd, rejections, aiDetectorCounts };
  const embeddings = await embedBatch(kept.map((x) => x.p.text));
  const { data: existingRows } = await client.database
    .from('hook_examples')
    .select('embedding')
    .eq('niche_id', niche.id)
    .not('embedding', 'is', null)
    .limit(2000);
  const existingEmbeddings = ((existingRows ?? []) as Array<{ embedding: number[] }>).map((r) => r.embedding);

  const finalRows: Array<{ row: Record<string, unknown>; hookId: string; ne: number }> = [];
  const accepted: number[][] = [...existingEmbeddings];
  for (let i = 0; i < kept.length; i++) {
    if (nearDupIndex(embeddings[i], accepted) !== -1) { rejections.nearDup++; continue; }
    accepted.push(embeddings[i]);
    const x = kept[i];
    const ne = normEngagement(x.p.likes, x.p.comments, x.p.followers);
    const hookId = `apify-${niche.id}-${Buffer.from(x.p.text).toString('base64').slice(0, 24)}`;
    finalRows.push({
      hookId,
      ne,
      row: {
        id: hookId,
        text: x.p.text.slice(0, 1800),
        author: x.p.author.replace(/^@+/, ''),
        platform: 'linkedin',
        verticals: [],
        niche_id: niche.id,
        embedding: toPgVector(embeddings[i]),
        pattern_class: x.pattern_class,
        ai_likelihood: x.ai,
        // norm_engagement is stored as the batch-percentile (0..1) of the raw
        // log-diff, NOT the raw value: match_niche_hooks blends it at weight 0.3
        // alongside cosine similarity and freshness, which are both already
        // 0..1. The raw ln(1+likes+3*comments) - ln(1+followers) is unbounded
        // and can be negative, so storing it raw would let engagement dominate
        // (or invert) the blend instead of contributing its intended share.
        norm_engagement: null as number | null, // placeholder, filled below once the batch is known
        mined_at: new Date().toISOString(),
      },
    });
  }

  // Rewrite norm_engagement as the percentile rank within this accepted batch,
  // now that the full batch of raw values is known.
  const neAll = finalRows.map((f) => f.ne);
  for (const f of finalRows) {
    f.row.norm_engagement = percentileRank(f.ne, neAll);
  }

  // Filter 7: insert hooks + create informative-prior arms.
  if (finalRows.length > 0) {
    await client.database.from('hook_examples').upsert(finalRows.map((f) => f.row), { onConflict: 'id' });
    await client.database.from('hook_arms').upsert(
      finalRows.map((f) => ({
        niche_id: niche.id,
        hook_id: f.hookId,
        alpha: priorAlpha(percentileRank(f.ne, neAll)),
        beta: 1,
      })),
      { onConflict: 'niche_id,hook_id' },
    );
  }

  await client.database.from('niches').update({
    status: 'active',
    last_mined_at: new Date().toISOString(),
  }).eq('id', niche.id);

  return { accepted: finalRows.length, costUsd, rejections, aiDetectorCounts };
}
