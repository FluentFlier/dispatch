import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Runaway guard only, NOT a product limit: how many topics the assistant may
 * arm is its own call (a "track YC Speedrun, HF0, funding, name changes, CEO
 * changes" brief legitimately needs more than a handful). This ceiling exists
 * so a malformed model response can't insert hundreds of poll rows. Mirror of
 * MAX_KEYWORD_SOURCES in the sources API.
 */
const MAX_KEYWORD_SOURCES = 50;
const KEYWORD_POLL_INTERVAL_MINUTES = 60;

/**
 * Mirrors an ICP's keywords into "Topics to monitor" (X `keyword_search`
 * sources) so setting an ICP via the assistant or the manual form also arms the
 * live signal engine. Additive and idempotent: never deletes a user-added topic,
 * skips keywords already monitored (case-insensitive), and respects the 5-topic
 * cap. Returns how many new topics were created.
 */
export async function syncIcpKeywordsToTopics(
  client: InsforgeClient,
  workspaceId: string,
  keywords: string[],
): Promise<number> {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  if (cleaned.length === 0) return 0;

  const { data: existing } = await client.database
    .from('signal_sources')
    .select('handle_or_url, label')
    .eq('workspace_id', workspaceId)
    .eq('source_type', 'keyword_search');

  const existingRows = (existing ?? []) as Array<{ handle_or_url: string | null; label: string | null }>;
  const have = new Set(
    existingRows.map((r) => (r.label ?? r.handle_or_url ?? '').trim().toLowerCase()).filter(Boolean),
  );
  const slotsFree = Math.max(0, MAX_KEYWORD_SOURCES - existingRows.length);
  if (slotsFree === 0) return 0;

  // Dedupe within the incoming list too, preserving order.
  const toAdd: string[] = [];
  for (const kw of cleaned) {
    const key = kw.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    toAdd.push(kw);
    if (toAdd.length >= slotsFree) break;
  }
  if (toAdd.length === 0) return 0;

  const rows = toAdd.map((kw) => ({
    workspace_id: workspaceId,
    platform: 'x',
    handle_or_url: kw,
    source_type: 'keyword_search',
    label: kw,
    enabled: true,
    poll_interval_minutes: KEYWORD_POLL_INTERVAL_MINUTES,
  }));

  const { error } = await client.database.from('signal_sources').insert(rows);
  if (error) throw error;
  return rows.length;
}
