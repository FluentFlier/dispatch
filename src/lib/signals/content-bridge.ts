import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

/** How far back a lead's last detected signal still counts as "timely". */
const TOPIC_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * Pulls recent high-signal topics into generation context ("post about what's
 * trending for you"). Signals live ON leads now (intent_flags.last_signal_*,
 * stamped by the intent bridge) - the standalone signal_events feed is retired.
 */
export async function getSignalTopicsForGeneration(
  client: InsforgeClient,
  workspaceId: string,
  limit = 3,
): Promise<string[]> {
  try {
    // Explicit columns on purpose (InsForge select('*') + .eq() quirk).
    const { data } = await client.database
      .from('signal_leads')
      .select('company_name, intent_flags')
      .eq('workspace_id', workspaceId)
      .limit(300);

    const since = Date.now() - TOPIC_WINDOW_MS;
    const rows = (data ?? []) as Array<{
      company_name: string | null;
      intent_flags: { last_signal_at?: string; last_signal_summary?: string; last_signal_type?: string } | null;
    }>;

    return rows
      .filter((r) => {
        const at = r.intent_flags?.last_signal_at;
        return at && Date.parse(at) >= since;
      })
      .sort(
        (a, b) =>
          Date.parse(b.intent_flags?.last_signal_at ?? '') -
          Date.parse(a.intent_flags?.last_signal_at ?? ''),
      )
      .slice(0, limit)
      .map((r) => {
        const summary = r.intent_flags?.last_signal_summary;
        const type = r.intent_flags?.last_signal_type?.replace(/_/g, ' ');
        const parts = [r.company_name, summary ?? type].filter(Boolean);
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
