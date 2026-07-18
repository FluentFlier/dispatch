import type { createClient } from '@insforge/sdk';
import { getDirectorySettings, updateDirectorySettings } from '@/lib/signals/leads/store';
import type { SignalSourceRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface WatchlistEntryInput {
  name: string;
  xHandle?: string;
  linkedinCompanyUrl?: string;
  keywords?: string[];
}

export interface AddWatchlistEntryResult {
  sourcesCreated: SignalSourceRow[];
  customKeywords: string[];
}

/**
 * Adds a workspace watchlist entry: up to two signal_sources rows (X account +
 * LinkedIn company page) plus any keywords merged into
 * signal_directory_settings.custom_keywords. Mirrors the insert shape used by
 * POST /api/signals/sources (existence check by workspace + handle_or_url,
 * then insert). Existing rows for the same handle/url are skipped, not
 * duplicated.
 */
export async function addWatchlistEntry(
  client: InsforgeClient,
  workspaceId: string,
  input: WatchlistEntryInput,
): Promise<AddWatchlistEntryResult> {
  const sourcesCreated: SignalSourceRow[] = [];

  const candidates: Array<Pick<SignalSourceRow, 'platform' | 'handle_or_url' | 'source_type'>> = [];
  if (input.xHandle?.trim()) {
    candidates.push({
      platform: 'x',
      handle_or_url: input.xHandle.trim().replace(/^@/, ''),
      source_type: 'account',
    });
  }
  if (input.linkedinCompanyUrl?.trim()) {
    candidates.push({
      platform: 'linkedin',
      handle_or_url: input.linkedinCompanyUrl.trim(),
      source_type: 'company_page',
    });
  }

  for (const candidate of candidates) {
    const { data: existing, error: selectError } = await client.database
      .from('signal_sources')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('handle_or_url', candidate.handle_or_url)
      .limit(1);
    if (selectError) throw selectError;
    if (existing && existing.length > 0) continue;

    const { data, error } = await client.database
      .from('signal_sources')
      .insert({
        workspace_id: workspaceId,
        platform: candidate.platform,
        handle_or_url: candidate.handle_or_url,
        source_type: candidate.source_type,
        label: input.name,
        enabled: true,
      })
      .select('*')
      .single();
    if (error) throw error;
    sourcesCreated.push(data as SignalSourceRow);
  }

  const newKeywords = (input.keywords ?? [])
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  let customKeywords: string[];
  if (newKeywords.length > 0) {
    const settings = await getDirectorySettings(client, workspaceId);
    customKeywords = Array.from(new Set((settings.custom_keywords ?? []).concat(newKeywords)));
    await updateDirectorySettings(client, workspaceId, { custom_keywords: customKeywords });
  } else {
    customKeywords = (await getDirectorySettings(client, workspaceId)).custom_keywords ?? [];
  }

  return { sourcesCreated, customKeywords };
}
