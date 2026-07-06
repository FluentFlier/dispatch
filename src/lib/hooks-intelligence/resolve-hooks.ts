import type { createClient } from '@insforge/sdk';
import { loadHookDataset, getBestHooksForContext } from './index';
import { getBestHooksForVerticalDB, getHooksByIdsFromDB } from './retriever';
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
}

function explainSource(source: 'db' | 'static' | 'mined', rlScore: number): string {
  if (source === 'db') {
    return `Learned score ${Math.round(rlScore)}/100 from your published post performance`;
  }
  if (source === 'mined') {
    return `Fresh from social listening (score ${Math.round(rlScore)}/100)`;
  }
  return `Bootstrap hook (score ${Math.round(rlScore)}/100)`;
}

/**
 * Resolves hooks for generation: DB-learned scores + hook_examples text + static fallback.
 * Single source of truth for both generation and /api/hooks/intelligence.
 */
export async function getBestHooksForGeneration(
  client: InsforgeClient | undefined,
  vertical: HookVertical | undefined,
  limit = 6,
): Promise<ResolvedHooksResult> {
  const dataset = loadHookDataset();
  const byId = new Map(dataset.hooks.map((h) => [h.id, h]));
  const explanations: HookExplanation[] = [];
  const hooks: ExtractedHook[] = [];

  if (client && vertical) {
    try {
      const dbRanked = await getBestHooksForVerticalDB(client, vertical, limit);
      const dbText = await getHooksByIdsFromDB(
        client,
        dbRanked.map((r) => r.hookId),
      );

      for (const ranked of dbRanked) {
        const mined = dbText.get(ranked.hookId);
        const staticHook = byId.get(ranked.hookId);
        const hook = mined ?? staticHook;
        if (!hook) continue;

        const source: HookExplanation['source'] = mined
          ? 'mined'
          : ranked.source === 'db'
            ? 'db'
            : 'static';

        hooks.push(hook);
        explanations.push({
          id: hook.id,
          text: hook.text.slice(0, 120),
          author: hook.author,
          rlScore: ranked.score,
          source,
          reason: explainSource(source, ranked.score),
        });

        if (hooks.length >= limit) {
          return { hooks: hooks.slice(0, limit), explanations: explanations.slice(0, limit) };
        }
      }
    } catch {
      // DB tables may not exist yet — fall through to static
    }
  }

  const fallback = getBestHooksForContext(vertical, limit - hooks.length);
  for (const h of fallback) {
    if (hooks.some((existing) => existing.id === h.id)) continue;
    const hook: ExtractedHook = {
      id: h.id,
      text: h.text,
      author: h.author,
      platform: h.platform ?? 'x',
      verticals: h.verticals,
      engagement: h.engagement,
      minedAt: h.minedAt,
    };
    hooks.push(hook);
    explanations.push({
      id: h.id,
      text: h.text.slice(0, 120),
      author: h.author,
      rlScore: h.score.total,
      source: 'static',
      reason: explainSource('static', h.score.total),
    });
  }

  return { hooks: hooks.slice(0, limit), explanations: explanations.slice(0, limit) };
}
