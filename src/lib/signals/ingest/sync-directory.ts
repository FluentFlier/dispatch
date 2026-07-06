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
import { scoreIcpFit } from '@/lib/signals/leads/icp-score';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { signalsDebugEnabled, signalsEnrichInlineEnabled } from '@/lib/signals/ingest/config';

type InsforgeClient = ReturnType<typeof createClient>;

const MAX_LEADS_PER_RUN = 200;

export interface DirectorySyncResult {
  inserted: number;
  updated: number;
  renamed: number;
  resolved: number;
  noContact: number;
  perSource: Array<{ source: LeadSource; count: number; error?: string }>;
  /** Human-readable "<source> failed: <reason>" lines for surfacing to the UI. */
  warnings: string[];
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
  const debug = signalsDebugEnabled();
  const result: DirectorySyncResult = {
    inserted: 0,
    updated: 0,
    renamed: 0,
    resolved: 0,
    noContact: 0,
    perSource: [],
    warnings: [],
  };

  if (debug) {
    console.log(
      `[directory-sync] workspace=${workspaceId} enabled_sources=` +
        `${JSON.stringify(settings.enabled_sources)}`,
    );
  }

  // --- Scrape enabled sources (isolated) ---
  const collected: IngestedLead[] = [];
  for (const source of settings.enabled_sources) {
    if (!DIRECTORY_QUERIES[source]) {
      if (debug) console.log(`[directory-sync] ${source} skipped — no query config`);
      continue;
    }
    try {
      const leads = await fetchDirectoryLeads(source);
      collected.push(...leads);
      result.perSource.push({ source, count: leads.length });
      if (debug) console.log(`[directory-sync] ${source} → ${leads.length} leads`);
    } catch (err) {
      const msg = err instanceof DirectoryScrapeError ? err.message : String(err);
      result.perSource.push({ source, count: 0, error: msg });
      result.warnings.push(`${source} failed: ${msg}`);
      // Always logged (not just under debug): a scrape failure is operationally
      // important even when the endpoint still returns 200 to the caller.
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
  // Auto-resolve every scraped lead inline via the FAST YC-detail lookup (one
  // HTTP fetch each) so contacts are populated without a manual click. The slow
  // TinyFish agent fallback stays off unless SIGNALS_ENRICH_INLINE is set —
  // fastOnly keeps the scrape within the request timeout.
  const fastOnly = !signalsEnrichInlineEnabled();
  const leads = await listLeads(client, workspaceId, { limit: MAX_LEADS_PER_RUN });
  for (const lead of leads) {
    // Retry anything not yet resolved (unresolved AND prior no_contact) — a lead
    // marked no_contact before the fast YC-detail lookup existed can now resolve.
    if (lead.contact_status !== 'resolved') {
      const res = await resolveLeadContacts(client, workspaceId, lead, { enrich: true, fastOnly });
      if (res.status === 'resolved') result.resolved += 1;
      if (res.status === 'no_contact') result.noContact += 1;
      lead.contact_status = res.status;
    }
    const fit = computeFitScore(lead, settings);
    // LLM-graded ICP fit dominates the blend; the deterministic heuristic
    // `fit` above only breaks ties (and is the sole signal when the LLM call
    // fails closed to neutral 0.5).
    //
    // Per-workspace daily budget gate: each scored lead is one LLM call, and a run
    // scores up to MAX_LEADS_PER_RUN (200) leads — repeatable via "Scrape now".
    // Without a cap this alone could drain provider credits. Gate on the workspace's
    // daily haiku cap; once hit (or no ICP configured), fall back to the neutral 0.5
    // score so the deterministic `fit` dominates and ranking degrades gracefully.
    const icpConfigured = settings.icp_verticals.length > 0 || settings.icp_keywords.length > 0;
    let icpFit = 0.5;
    if (icpConfigured && (await checkAndIncrementUsage(client, workspaceId, 'haiku')) !== 'blocked') {
      icpFit = await scoreIcpFit({
        companyName: lead.company_name,
        tagline: lead.tagline,
        tags: lead.tags,
        verticals: settings.icp_verticals,
        keywords: settings.icp_keywords,
      });
    }
    const blendedFit = Number((0.7 * icpFit + 0.3 * fit).toFixed(3));
    const rank = computeRankScore(lead, blendedFit, today);
    await updateLead(client, workspaceId, lead.id, { fit_score: blendedFit, rank_score: rank });
  }

  return result;
}
