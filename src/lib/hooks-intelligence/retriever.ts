/**
 * Hook/Post Retriever + RAG Layer (core for agents/generation)
 *
 * Now with proper RAG over mined gstack data + scores + categories.
 * Semantic + scored retrieval for best real-world examples.
 * This + RL (scorer + edit/performance feedback) + Imagine eval loop = the training/intelligence.
 * Upgrade: InsForge vector embeddings when available.
 */

import { loadHookDataset } from './index';
import type { ExtractedHook, HookVertical } from './types';
import type { createClient } from '@insforge/sdk';
import { toPgVector } from '@/lib/embeddings';

type InsforgeClient = ReturnType<typeof createClient>;

export interface RetrieveOptions {
  query?: string;
  vertical?: HookVertical;
  limit?: number;
  minScore?: number;
  useRAG?: boolean; // Enable semantic over keyword
}

/**
 * Advanced retrieve with RAG flavor: score + keyword + simple semantic (word overlap for now).
 * Mined data becomes the knowledge base for everything.
 */
export function retrieveBestExamples(options: RetrieveOptions = {}): ExtractedHook[] {
  const dataset = loadHookDataset();
  let candidates = dataset.hooks;

  if (options.vertical) {
    candidates = candidates.filter(h => h.verticals?.includes(options.vertical!));
  }

  if (options.query) {
    const q = options.query.toLowerCase().split(/\s+/);
    candidates = candidates.filter(h => {
      const text = (h.text + ' ' + h.author).toLowerCase();
      return q.some(word => text.includes(word)) ||
             (h.verticals || []).some(v => v.includes(options.query!.toLowerCase()));
    });
  }

  const scored = candidates.map(h => {
    const base = (dataset.scores[h.id]?.total || 70);
    let rel = 0;
    if (options.query) {
      const qWords = options.query.toLowerCase().split(/\s+/);
      const text = h.text.toLowerCase();
      rel = qWords.filter(w => text.includes(w)).length * 8;
    }
    return { ...h, _rankScore: base + rel };
  });

  let sorted = scored.sort((a, b) => (b as any)._rankScore - (a as any)._rankScore);

  if (options.minScore) {
    sorted = sorted.filter(s => (s as any)._rankScore >= options.minScore!);
  }

  // Drop near-identical hook text (mined dataset has the same line from multiple
  // authors). Keep the highest-ranked copy so results stay distinct.
  const seenText = new Set<string>();
  sorted = sorted.filter(s => {
    const key = s.text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
    if (seenText.has(key)) return false;
    seenText.add(key);
    return true;
  });

  return sorted.slice(0, options.limit || 8).map(({ _rankScore, ...h }) => h as ExtractedHook);
}

/**
 * RAG context for agents/voice: Best examples + categorized if engagement data present.
 */
export function getHookContextForAgent(options: RetrieveOptions = {}): string {
  const examples = retrieveBestExamples({ ...options, useRAG: true });
  if (examples.length === 0) return '';

  let context = `\n\nRAG FROM REAL MINED DATA (gstack + RL scored, Imagine-eval inspired):\n`;
  examples.forEach((h, i) => {
    const author = String(h.author ?? '').replace(/^@+/, '');
    context += `${i+1}. "${h.text.substring(0, 300)}..." (@${author}, verticals: ${(h.verticals || []).join(', ')})\n`;
  });

  return context;
}

/**
 * For full RAG training: This function + mined dataset = the knowledge.
 * Future: Embed all hooks, retrieve by cosine. For now, this + scorer = working intelligence.
 */

/**
 * DB-first hook retrieval: reads hook_performance learned scores, fills remaining
 * slots with static scorer fallback. Called by voice pipeline for generation context.
 * DB scores = real engagement signal. Static = bundled dataset heuristics.
 */
export async function getBestHooksForVerticalDB(
  client: InsforgeClient,
  vertical: HookVertical,
  limit = 8,
): Promise<Array<{ hookId: string; score: number; source: 'db' | 'static' }>> {
  const { data: dbScores } = await client.database
    .from('hook_performance')
    .select('hook_id, rl_score')
    .eq('vertical', vertical)
    .order('rl_score', { ascending: false })
    .limit(limit * 2);

  const dbHookIds = new Set((dbScores ?? []).map(r => r.hook_id as string));
  const results: Array<{ hookId: string; score: number; source: 'db' | 'static' }> =
    (dbScores ?? []).map(r => ({
      hookId: r.hook_id as string,
      score: Number(r.rl_score),
      source: 'db' as const,
    }));

  if (results.length < limit) {
    const dataset = loadHookDataset();
    const staticHooks = dataset.hooks
      .filter(h => h.verticals?.includes(vertical) && !dbHookIds.has(h.id))
      .sort((a, b) => (dataset.scores[b.id]?.total ?? 70) - (dataset.scores[a.id]?.total ?? 70))
      .slice(0, limit - results.length);
    for (const h of staticHooks) {
      results.push({ hookId: h.id, score: dataset.scores[h.id]?.total ?? 70, source: 'static' });
    }
  }
  return results.slice(0, limit);
}

/**
 * Loads hook text from hook_examples DB table by ID.
 * Falls back to empty for IDs not yet migrated from Apify mining.
 */
export async function getHooksByIdsFromDB(
  client: InsforgeClient,
  hookIds: string[],
): Promise<Map<string, ExtractedHook>> {
  const map = new Map<string, ExtractedHook>();
  if (hookIds.length === 0) return map;

  const unique = Array.from(new Set(hookIds));
  const { data, error } = await client.database
    .from('hook_examples')
    .select('id, text, author, platform, verticals, engagement, mined_at')
    .in('id', unique);

  if (error || !data) return map;

  for (const row of data) {
    const r = row as {
      id: string;
      text: string;
      author: string;
      platform: string;
      verticals: string[] | null;
      engagement: ExtractedHook['engagement'];
      mined_at: string | null;
    };
    map.set(r.id, {
      id: r.id,
      text: r.text,
      author: r.author,
      platform: (r.platform === 'linkedin' ? 'linkedin' : r.platform === 'x' ? 'x' : 'other') as ExtractedHook['platform'],
      verticals: (r.verticals ?? ['general']) as HookVertical[],
      engagement: r.engagement,
      minedAt: r.mined_at ?? new Date().toISOString(),
    });
  }

  return map;
}

export interface NicheCandidate {
  hookId: string;
  text: string;
  arm: { alpha: number; beta: number };
}

/**
 * Top candidates for a niche by the SQL blend (semantic + engagement + freshness),
 * already filtered to non-bait and under the burn-out cap by match_niche_hooks.
 */
export async function getNicheHookCandidates(
  client: InsforgeClient,
  nicheId: string,
  topicEmbedding: number[],
  limit = 24,
): Promise<NicheCandidate[]> {
  const { data, error } = await (client.database as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc('match_niche_hooks', {
    p_niche_id: nicheId,
    p_topic_embedding: toPgVector(topicEmbedding),
    p_limit: limit,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ hook_id: string; hook_text: string; alpha: number; beta: number }>).map((r) => ({
    hookId: r.hook_id,
    text: r.hook_text,
    arm: { alpha: Number(r.alpha), beta: Number(r.beta) },
  }));
}

/** Increments pulls + internal_uses_7d for the hooks we injected this request. */
export async function incrementHookUsage(
  client: InsforgeClient,
  picks: Array<{ nicheId: string; hookId: string }>,
): Promise<void> {
  if (picks.length === 0) return;
  await (client.database as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: unknown }>;
  }).rpc('increment_hook_usage', {
    p_picks: picks.map((p) => ({ niche_id: p.nicheId, hook_id: p.hookId })),
  }).catch((e: unknown) => console.warn('[hooks] usage bump failed', e));
}

/**
 * Phase-4 reward extension point: Bayesian update of an arm from a binary reward.
 * NOT called by any cron in Phase 2 - intelligence-sync wires it in Phase 4.
 */
export async function applyHookReward(
  client: InsforgeClient,
  nicheId: string,
  hookId: string,
  reward: number,
): Promise<void> {
  const { data } = await client.database.from('hook_arms')
    .select('alpha, beta').eq('niche_id', nicheId).eq('hook_id', hookId).single();
  const arm = (data as { alpha: number; beta: number } | null) ?? { alpha: 1, beta: 1 };
  await client.database.from('hook_arms').update({
    alpha: arm.alpha + reward,
    beta: arm.beta + (1 - reward),
    updated_at: new Date().toISOString(),
  }).eq('niche_id', nicheId).eq('hook_id', hookId);
}
