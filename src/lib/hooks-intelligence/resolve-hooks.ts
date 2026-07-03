import type { createClient } from '@insforge/sdk';
import { loadHookDataset, getBestHooksForContext } from './index';
import { getBestHooksForVerticalDB } from './retriever';
import type { ExtractedHook, HookVertical } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Resolves hooks for generation: DB-learned scores first, static dataset fallback.
 */
export async function getBestHooksForGeneration(
  client: InsforgeClient | undefined,
  vertical: HookVertical | undefined,
  limit = 6,
): Promise<ExtractedHook[]> {
  const dataset = loadHookDataset();
  const byId = new Map(dataset.hooks.map((h) => [h.id, h]));

  if (client && vertical) {
    try {
      const dbRanked = await getBestHooksForVerticalDB(client, vertical, limit);
      const fromDb = dbRanked
        .map((r) => byId.get(r.hookId))
        .filter((h): h is ExtractedHook => Boolean(h));
      if (fromDb.length >= limit) return fromDb.slice(0, limit);
    } catch {
      // DB table may not exist yet
    }
  }

  return getBestHooksForContext(vertical, limit).map((h) => ({
    id: h.id,
    text: h.text,
    author: h.author,
    platform: h.platform ?? 'x',
    verticals: h.verticals,
    engagement: h.engagement,
    minedAt: h.minedAt,
  }));
}
