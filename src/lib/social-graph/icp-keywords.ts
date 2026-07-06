import type { createClient } from '@insforge/sdk';
import { getDirectorySettings } from '@/lib/signals/leads/store';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Loads ICP keyword hints from Signals directory settings so warm-contact
 * scoring matches the same criteria used for lead directory ingest.
 */
export async function loadIcpKeywordsForWorkspace(
  client: InsforgeClient,
  workspaceId: string,
): Promise<string[]> {
  try {
    const settings = await getDirectorySettings(client, workspaceId);
    const keywords = settings.icp_keywords ?? [];
    return keywords.map((k) => k.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
