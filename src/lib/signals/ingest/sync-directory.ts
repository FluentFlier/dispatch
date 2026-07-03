import type { createClient } from '@insforge/sdk';
import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { fetchDirectoryLeads, DirectoryScrapeError } from '@/lib/signals/ingest/tinyfish-fetch';
import { DIRECTORY_QUERIES } from '@/lib/signals/ingest/directory-queries';
import {
  getDirectorySettings,
  listLeads,
  updateLead,
  upsertIngestedLeads,
} from '@/lib/signals/leads/store';
import { resolveLeadContacts } from '@/lib/signals/leads/resolve-contact';
import { computeFitScore, computeRankScore } from '@/lib/signals/leads/score';

type InsforgeClient = ReturnType<typeof createClient>;

const MAX_LEADS_PER_RUN = 200;

export interface DirectorySyncResult {
  inserted: number;
  updated: number;
  renamed: number;
  resolved: number;
  noContact: number;
  perSource: Array<{ source: LeadSource; count: number; error?: string }>;
}

/**
 * One directory sync for a workspace: scrape each enabled directory (failures
 * isolated per-source), upsert with rename detection, resolve contacts for
 * still-unresolved leads, then re-score every lead. Idempotent — safe to run
 * repeatedly; only genuinely new anchors insert.
 */
export async function syncWorkspaceDirectory(
  client: InsforgeClient,
  workspaceId: string,
): Promise<DirectorySyncResult> {
  const settings = await getDirectorySettings(client, workspaceId);
  const today = new Date().toISOString().slice(0, 10);
  const result: DirectorySyncResult = {
    inserted: 0,
    updated: 0,
    renamed: 0,
    resolved: 0,
    noContact: 0,
    perSource: [],
  };

  // --- Scrape enabled sources (isolated) ---
  const collected: IngestedLead[] = [];
  for (const source of settings.enabled_sources) {
    if (!DIRECTORY_QUERIES[source]) continue;
    try {
      const leads = await fetchDirectoryLeads(source);
      collected.push(...leads);
      result.perSource.push({ source, count: leads.length });
    } catch (err) {
      const msg = err instanceof DirectoryScrapeError ? err.message : String(err);
      result.perSource.push({ source, count: 0, error: msg });
      console.error(`[directory-sync] ${source} failed:`, msg);
    }
  }

  // Per-run budget cap (log when truncated — no silent cap).
  let batch = collected;
  if (batch.length > MAX_LEADS_PER_RUN) {
    console.warn(`[directory-sync] capping ${batch.length} → ${MAX_LEADS_PER_RUN} leads this run`);
    batch = batch.slice(0, MAX_LEADS_PER_RUN);
  }

  const upsert = await upsertIngestedLeads(client, workspaceId, batch, today);
  result.inserted = upsert.inserted;
  result.updated = upsert.updated;
  result.renamed = upsert.renamed;

  // --- Resolve + score ---
  const leads = await listLeads(client, workspaceId, { limit: MAX_LEADS_PER_RUN });
  for (const lead of leads) {
    if (lead.contact_status === 'unresolved') {
      const res = await resolveLeadContacts(client, workspaceId, lead);
      if (res.status === 'resolved') result.resolved += 1;
      if (res.status === 'no_contact') result.noContact += 1;
      lead.contact_status = res.status;
    }
    const fit = computeFitScore(lead, settings);
    const rank = computeRankScore(lead, fit, today);
    await updateLead(client, workspaceId, lead.id, { fit_score: fit, rank_score: rank });
  }

  return result;
}
