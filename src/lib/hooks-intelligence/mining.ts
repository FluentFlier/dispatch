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
import { embedBatch, toPgVector, parseVec } from '@/lib/embeddings';
import { priorAlpha } from './thompson';
import { runChecks } from '@/lib/content-pipeline/checks';
import { cosineSim } from './niche-resolver';

type InsforgeClient = ReturnType<typeof createClient>;

const APIFY_ACTOR = process.env.HOOKS_MINING_ACTOR || 'apimaestro/linkedin-posts-search-scraper-no-cookies';
export const COST_PER_RESULT_USD = 0.005; // $5 / 1k results (spec 2.3)
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
  /** Caught by the filter-2 deterministic bait_hook regex registry. */
  bait: number;
  /** Caught by the filter-5 LLM classifier - separate counter so the funnel shows which layer fired. */
  bait_classifier: number;
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

const CLASSIFY_CHUNK = 50;

/**
 * LLM batch extraction: pattern_class and niche-fit 0-10 (cheap tier), one call
 * per <= 50 posts (spec 2.3.5). A failed or malformed chunk response degrades
 * only that chunk (defaults: 'other'/fit 0, which filter 5 then rejects) so a
 * single bad LLM reply never sinks the whole batch.
 */
export async function classifyBatch(
  posts: RawPost[],
  nicheLabel: string,
): Promise<Array<{ pattern_class: string; fit: number }>> {
  const system =
    'For each LinkedIn post, return JSON {"results":[{"pattern_class": one of ' +
    '["contrarian","number_result","story_open","question","how_to","bait","other"], ' +
    '"fit": integer 0-10 how well it fits the niche}]}. Order matches input. No prose.';
  const out: Array<{ pattern_class: string; fit: number }> = [];
  for (let start = 0; start < posts.length; start += CLASSIFY_CHUNK) {
    const chunk = posts.slice(start, start + CLASSIFY_CHUNK);
    let parsed: { results?: Array<{ pattern_class?: string; fit?: number }> } = {};
    try {
      const user = JSON.stringify({ niche: nicheLabel, posts: chunk.map((p) => extractOpener(p.text)) });
      const raw = await chatCompletion(system, user, {
        model: resolveModel('fast'),
        temperature: 0,
        responseFormat: 'json',
        maxTokens: 1200,
      });
      parsed = parseLlmJson<{ results?: Array<{ pattern_class?: string; fit?: number }> }>(raw) ?? {};
    } catch (err) {
      console.error('[mining] classify chunk failed; degrading chunk to fit 0', err);
    }
    for (let i = 0; i < chunk.length; i++) {
      out.push({
        pattern_class: parsed.results?.[i]?.pattern_class ?? 'other',
        fit: Number(parsed.results?.[i]?.fit ?? 0),
      });
    }
  }
  return out;
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
  const rejections: RejectionCounts = { structure: 0, bait: 0, bait_classifier: 0, engagement: 0, ai: 0, fit: 0, nearDup: 0 };
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
  // Score is paired with its post BEFORE filtering so indices never misalign.
  const aiResults = await Promise.all(posts.map((p) => aiTextLikelihood(p.text)));
  for (const r of aiResults) aiDetectorCounts[r.detector]++;
  const humanish = posts
    .map((p, i) => ({ p, ai: aiResults[i].score }))
    .filter((x) => { const ok = x.ai <= AI_REJECT_ABOVE; if (!ok) rejections.ai++; return ok; });

  // Filter 5: LLM pattern_class + niche fit (chunked, <= 50/call), reject fit < 6.
  if (humanish.length === 0) return { accepted: 0, costUsd, rejections, aiDetectorCounts };
  const classes = await classifyBatch(humanish.map((x) => x.p), niche.label);
  const kept = humanish
    .map((x, i) => ({ ...x, ...classes[i] }))
    .filter((x) => {
      // Belt-and-suspenders bait catch, counted separately from the filter-2 regex.
      if (x.pattern_class === 'bait') { rejections.bait_classifier++; return false; }
      const ok = x.fit >= FIT_REJECT_BELOW;
      if (!ok) rejections.fit++;
      return ok;
    });

  // Filter 6: embed + near-dup (cosine >= 0.92). Spec 2.3.6: on a near-dup the
  // HIGHER norm_engagement post wins. Sorting survivors strongest-first makes
  // the within-batch case fall out of first-seen-wins; against the DB, a
  // stronger new post overwrites the weaker existing row IN PLACE (same id via
  // the id-conflict upsert), which keeps the hook_arms row and its learned
  // Thompson state instead of orphaning it with a delete + insert.
  if (kept.length === 0) return { accepted: 0, costUsd, rejections, aiDetectorCounts };
  const survivors = kept
    .map((x) => ({ ...x, ne: normEngagement(x.p.likes, x.p.comments, x.p.followers) }))
    .sort((a, b) => b.ne - a.ne);
  // Percentile base = all dedup candidates (known up front, stable across the
  // loop). Stored norm_engagement must be 0..1 because match_niche_hooks blends
  // it at weight 0.3 against two other 0..1 terms - the raw log-diff
  // ln(1+likes+3*comments) - ln(1+followers) is unbounded and can be negative,
  // so storing it raw would let engagement dominate (or invert) the blend.
  const neAll = survivors.map((s) => s.ne);
  const embeddings = await embedBatch(survivors.map((s) => s.p.text));
  const { data: existingRows } = await client.database
    .from('hook_examples')
    .select('id, embedding, norm_engagement')
    .eq('niche_id', niche.id)
    .not('embedding', 'is', null)
    .limit(2000);
  // B1: PostgREST reads the `vector` column back as a JSON string ("[1,2,3]"),
  // not a parsed array (verified live) - parse at the read site so nearDupIndex's
  // cosineSim call never silently NaNs on every existing DB row.
  const existingRaw = (existingRows ?? []) as Array<{ id: string; embedding: unknown; norm_engagement: number | null }>;
  let unparseableExisting = 0;
  const existing = existingRaw.flatMap((r) => {
    const vec = parseVec(r.embedding);
    if (vec === null) { unparseableExisting++; return []; }
    return [{ id: r.id, embedding: vec, norm_engagement: r.norm_engagement }];
  });
  if (unparseableExisting > 0) {
    console.warn('[mining] skipped hook_examples rows with unparseable embeddings', { nicheId: niche.id, unparseableExisting });
  }
  const existingVecs = existing.map((r) => r.embedding);

  const finalRows: Array<{ row: Record<string, unknown>; hookId: string; ne: number; isReplacement: boolean }> = [];
  const batchVecs: number[][] = [];
  for (let i = 0; i < survivors.length; i++) {
    const s = survivors[i];
    const vec = embeddings[i];
    // Within batch: anything already accepted has higher engagement (sorted desc).
    if (nearDupIndex(vec, batchVecs) !== -1) { rejections.nearDup++; continue; }
    const pct = percentileRank(s.ne, neAll);
    const exIdx = nearDupIndex(vec, existingVecs);
    let hookId: string;
    let isReplacement = false;
    if (exIdx !== -1) {
      // Both sides are 0..1 batch percentiles (each within its own mining run) -
      // the only engagement scale the DB stores; higher wins per spec 2.3.6.
      if (pct <= (existing[exIdx].norm_engagement ?? 0)) { rejections.nearDup++; continue; }
      hookId = existing[exIdx].id; // overwrite the weaker existing row in place
      existingVecs[exIdx] = vec;   // later batch items now dedupe against the winner
      isReplacement = true;
    } else {
      hookId = `apify-${niche.id}-${Buffer.from(s.p.text).toString('base64').slice(0, 24)}`;
    }
    batchVecs.push(vec);
    finalRows.push({
      hookId,
      ne: s.ne,
      isReplacement,
      row: {
        id: hookId,
        text: s.p.text.slice(0, 1800),
        author: s.p.author.replace(/^@+/, ''),
        platform: 'linkedin',
        verticals: [],
        niche_id: niche.id,
        embedding: toPgVector(vec),
        pattern_class: s.pattern_class,
        ai_likelihood: s.ai,
        norm_engagement: pct,
        mined_at: new Date().toISOString(),
      },
    });
  }

  // Filter 7: insert hooks + informative-prior arms. Replacements keep their
  // existing arm (same hook_id), preserving learned Thompson state.
  if (finalRows.length > 0) {
    await client.database.from('hook_examples').upsert(finalRows.map((f) => f.row), { onConflict: 'id' });
    const newArms = finalRows.filter((f) => !f.isReplacement);
    if (newArms.length > 0) {
      await client.database.from('hook_arms').upsert(
        newArms.map((f) => ({
          niche_id: niche.id,
          hook_id: f.hookId,
          alpha: priorAlpha(percentileRank(f.ne, neAll)),
          beta: 1,
        })),
        { onConflict: 'niche_id,hook_id' },
      );
    }
  }

  await client.database.from('niches').update({
    status: 'active',
    last_mined_at: new Date().toISOString(),
  }).eq('id', niche.id);

  return { accepted: finalRows.length, costUsd, rejections, aiDetectorCounts };
}
