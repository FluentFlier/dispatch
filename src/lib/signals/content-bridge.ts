import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Pulls recent high-signal topics from the Signals engine into generation context.
 * Bridges GTM listening → content creation ("post about what's trending for you").
 */
export async function getSignalTopicsForGeneration(
  client: InsforgeClient,
  workspaceId: string,
  limit = 3,
): Promise<string[]> {
  try {
    const { data: events } = await client.database
      .from('signal_events')
      .select('title, summary, category')
      .eq('workspace_id', workspaceId)
      .in('status', ['new', 'drafted', 'approved'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!events?.length) return [];

    return events.map((e) => {
      const row = e as { title?: string; summary?: string; category?: string };
      const parts = [row.title, row.summary].filter(Boolean);
      return parts.join(' - ').slice(0, 200);
    });
  } catch {
    return [];
  }
}

export function formatSignalTopicsBlock(topics: string[]): string {
  if (topics.length === 0) return '';
  return `\n\nRECENT SIGNALS (timely topics from your listening feed - use if relevant):\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
}
