import type { createClient } from '@insforge/sdk';
import { embedText, toPgVector } from '@/lib/embeddings';

type InsforgeClient = ReturnType<typeof createClient>;

interface ChunkMatch {
  id: string;
  content: string;
  similarity: number;
}

/**
 * Retrieves the most relevant slices of a series' dropped resource material for a
 * given query (a part title/core point, or the series concept at plan time). This
 * is the NotebookLM half of the grounding stack - the user's OWN uploaded sources.
 * Voice, persona, and past posts are layered in separately by loadCreatorVoiceContext
 * on the generation path, so this deliberately returns only the source material to
 * avoid double-injecting brain/Supermemory context.
 *
 * Returns a formatted block ready to append to a generation prompt, or '' when the
 * series has no indexed material or embeddings are unavailable (degrades quietly).
 */
export async function retrieveSeriesGrounding(
  client: InsforgeClient,
  seriesId: string,
  query: string,
  limit = 8,
): Promise<string> {
  const q = query.trim();
  if (!q) return '';

  let vector: number[];
  try {
    vector = await embedText(q);
  } catch {
    return ''; // no embeddings key -> no source grounding, generation still runs
  }

  const { data, error } = await (client.database as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc('match_series_chunks', {
    p_series_id: seriesId,
    p_query_embedding: toPgVector(vector),
    p_limit: limit,
  });

  if (error || !Array.isArray(data) || data.length === 0) return '';

  const matches = data as ChunkMatch[];
  const body = matches
    .map((m, i) => `[${i + 1}] ${m.content.trim()}`)
    .join('\n\n');

  return [
    'SERIES SOURCE MATERIAL (the creator\'s own reference material for this series -',
    'ground the post in these facts and details; do not invent specifics not supported here):',
    body,
  ].join('\n');
}
