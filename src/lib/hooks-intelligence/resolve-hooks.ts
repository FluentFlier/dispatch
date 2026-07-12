import type { createClient } from '@insforge/sdk';
import { getBestHooksForContext } from './index';
import { getNicheHookCandidates, incrementHookUsage } from './retriever';
import { pickTopK } from './thompson';
import { embedText } from '@/lib/embeddings';
import type { ExtractedHook, HookVertical } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface HookExplanation {
  id: string;
  text: string;
  author: string;
  rlScore: number;
  source: 'db' | 'static' | 'mined';
  reason: string;
}

export interface ResolvedHooksResult {
  hooks: ExtractedHook[];
  explanations: HookExplanation[];
  /** True when the DB-learned path produced zero hooks and static fallback filled the list. */
  usedStaticFallback: boolean;
}

export interface GetHooksOptions {
  nicheId?: string;
  topicText: string;
  vertical?: HookVertical;
  limit?: number;
  rng?: () => number;
}

/**
 * Generation-time hook selection (spec 2.4). Niche path: SQL blend candidates ->
 * Thompson sampling over arms -> usage bump. Falls back to the static bundled
 * dataset when there is no client, no niche, or the niche has no mined hooks yet,
 * or when embedding the topic fails (e.g. OPENAI_EMBEDDINGS_KEY not provisioned).
 */
export async function getBestHooksForGeneration(
  client: InsforgeClient | undefined,
  opts: GetHooksOptions,
): Promise<ResolvedHooksResult> {
  const limit = opts.limit ?? 3;

  if (client && opts.nicheId) {
    try {
      const topicEmbedding = await embedText(opts.topicText);
      const candidates = await getNicheHookCandidates(client, opts.nicheId, topicEmbedding, 24);
      if (candidates.length > 0) {
        const picked = pickTopK(candidates, limit, opts.rng);
        await incrementHookUsage(client, picked.map((c) => ({ nicheId: opts.nicheId!, hookId: c.hookId })));
        const hooks: ExtractedHook[] = picked.map((c) => ({
          id: c.hookId,
          text: c.text,
          author: 'mined',
          platform: 'linkedin',
          verticals: [],
          engagement: undefined,
          minedAt: new Date().toISOString(),
        }));
        const explanations: HookExplanation[] = picked.map((c) => ({
          id: c.hookId,
          text: c.text.slice(0, 120),
          author: 'mined',
          rlScore: Math.round((c.arm.alpha / (c.arm.alpha + c.arm.beta)) * 100),
          source: 'mined',
          reason: 'Selected by Thompson sampling from your niche corpus',
        }));
        return { hooks, explanations, usedStaticFallback: false };
      }
    } catch (e) {
      // Caller (index.ts) emits pipeline_events 'hook_fallback_static' off the
      // usedStaticFallback flag below - no DB call from this low-level module.
      console.warn('[hooks] niche retrieval failed, using static fallback', e);
    }
  }

  // Static fallback (unchanged behavior): dedup by id, keep the existing
  // head/tail diversity dedup already applied inside getBestHooksForContext.
  const fallback = getBestHooksForContext(opts.vertical, limit);
  const hooks: ExtractedHook[] = [];
  const explanations: HookExplanation[] = [];
  for (const h of fallback) {
    if (hooks.some((existing) => existing.id === h.id)) continue;
    hooks.push({
      id: h.id,
      text: h.text,
      author: h.author,
      platform: h.platform ?? 'x',
      verticals: h.verticals,
      engagement: h.engagement,
      minedAt: h.minedAt,
    });
    explanations.push({
      id: h.id,
      text: h.text.slice(0, 120),
      author: h.author,
      rlScore: h.score.total,
      source: 'static',
      reason: `Bootstrap hook (score ${Math.round(h.score.total)}/100)`,
    });
  }
  return { hooks: hooks.slice(0, limit), explanations: explanations.slice(0, limit), usedStaticFallback: true };
}
