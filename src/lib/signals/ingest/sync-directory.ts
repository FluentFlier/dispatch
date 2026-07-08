import type { createClient } from '@insforge/sdk';
import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { fetchDirectoryLeads, DirectoryScrapeError } from '@/lib/signals/ingest/tinyfish-fetch';
import { fetchIcpDiscoveryLeads } from '@/lib/signals/ingest/icp-discovery';
import { icpToSearchQuery } from '@/lib/signals/icp/parse-description';
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
import { mapWithConcurrency } from '@/lib/util/concurrency';

type InsforgeClient = ReturnType<typeof createClient>;

const MAX_LEADS_PER_RUN = 200;

/**
 * Cap on concurrent scoreIcpFit (LLM) calls during the re-score pass. Matches
 * the batch size already used for other bounded LLM fan-out in signals-sync -
 * fast enough to avoid a fully serial per-lead loop, bounded enough to avoid
 * unleashing MAX_LEADS_PER_RUN simultaneous LLM calls.
 */
const ICP_CONCURRENCY = 5;

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

/** Coarse phase a sync run is in, ordered as they execute. */
export type SyncPhase =
  | 'scraping'
  | 'discovery'
  | 'saving'
  | 'resolving'
  | 'scoring'
  | 'ranking'
  | 'done';

/**
 * A single progress tick emitted during a sync run. `pct` is an overall 0-100
 * estimate (monotonic, weighted per phase); `current`/`total` are populated for
 * the per-lead phases so the UI can show real counts, not just a spinner.
 */
export interface SyncProgress {
  phase: SyncPhase;
  label: string;
  pct: number;
  current?: number;
  total?: number;
}

export interface SyncOptions {
  onProgress?: (p: SyncProgress) => void;
}

/** Phase weight boundaries on the 0-100 bar. Scrape + resolve are the slow legs. */
const PCT = {
  scrapeStart: 3,
  scrapeEnd: 40,
  discoveryEnd: 45,
  savingEnd: 50,
  resolveEnd: 85,
  scoringEnd: 92,
  rankingEnd: 100,
} as const;

/**
 * One directory sync for a workspace: scrape each enabled directory (failures
 * isolated per-source), upsert with rename detection, resolve contacts for
 * still-unresolved leads, then re-score every lead. Idempotent — safe to run
 * repeatedly; only genuinely new anchors insert.
 */
export async function syncWorkspaceDirectory(
  client: InsforgeClient,
  workspaceId: string,
  opts: SyncOptions = {},
): Promise<DirectorySyncResult> {
  const emit = (p: SyncProgress) => {
    try {
      opts.onProgress?.(p);
    } catch {
      // Progress reporting must never break the sync itself.
    }
  };
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
  const icpQuery = icpToSearchQuery(
    settings.icp_verticals ?? [],
    settings.icp_keywords ?? [],
    settings.icp_description,
  );
  const collected: IngestedLead[] = [];
  const sources = settings.enabled_sources.filter((s) => DIRECTORY_QUERIES[s]);
  emit({ phase: 'scraping', label: 'Starting scrape…', pct: PCT.scrapeStart });
  let sourceIdx = 0;
  for (const source of settings.enabled_sources) {
    if (!DIRECTORY_QUERIES[source]) {
      if (debug) console.log(`[directory-sync] ${source} skipped — no query config`);
      continue;
    }
    emit({
      phase: 'scraping',
      label: `Scraping ${source.replace(/_/g, ' ')}…`,
      pct: phasePct(PCT.scrapeStart, PCT.scrapeEnd, sourceIdx, sources.length),
      current: sourceIdx,
      total: sources.length,
    });
    try {
      const leads = await fetchDirectoryLeads(source, { icpQuery });
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
    sourceIdx += 1;
  }

  // ICP-driven discovery (BigSet-style): extra pass when ICP is configured.
  if (icpQuery || settings.icp_description?.trim()) {
    emit({ phase: 'discovery', label: 'Discovering ICP matches…', pct: PCT.scrapeEnd });
    try {
      const icpLeads = await fetchIcpDiscoveryLeads(settings);
      const before = collected.length;
      const seen = new Set(collected.map((l) => l.externalId));
      for (const lead of icpLeads) {
        if (!seen.has(lead.externalId)) {
          collected.push(lead);
          seen.add(lead.externalId);
        }
      }
      const added = collected.length - before;
      result.perSource.push({ source: 'manual', count: added });
      if (debug) console.log(`[directory-sync] icp-discovery → ${added} new leads`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`icp_discovery failed: ${msg}`);
      console.error('[directory-sync] icp_discovery failed:', msg);
    }
  }

  // Per-run budget cap (log when truncated — no silent cap).
  let batch = collected;
  if (batch.length > MAX_LEADS_PER_RUN) {
    console.warn(`[directory-sync] capping ${batch.length} → ${MAX_LEADS_PER_RUN} leads this run`);
    batch = batch.slice(0, MAX_LEADS_PER_RUN);
  }

  emit({ phase: 'saving', label: `Saving ${batch.length} companies…`, pct: PCT.discoveryEnd });
  const upsert = await upsertIngestedLeads(client, workspaceId, batch, today);
  result.inserted = upsert.inserted;
  result.updated = upsert.updated;
  result.renamed = upsert.renamed;
  emit({
    phase: 'saving',
    label: `Saved ${upsert.inserted} new, ${upsert.updated} updated`,
    pct: PCT.savingEnd,
  });

  // --- Resolve + score ---
  // Auto-resolve every scraped lead inline via the FAST YC-detail lookup (one
  // HTTP fetch each) so contacts are populated without a manual click. The slow
  // TinyFish agent fallback stays off unless SIGNALS_ENRICH_INLINE is set —
  // fastOnly keeps the scrape within the request timeout.
  const fastOnly = !signalsEnrichInlineEnabled();
  const leads = await listLeads(client, workspaceId, { limit: MAX_LEADS_PER_RUN });

  // Phase A (sequential): resolve contacts. External HTTP per lead, kept
  // serial to avoid hammering the resolution providers.
  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    emit({
      phase: 'resolving',
      label: `Finding contacts (${i + 1}/${leads.length})…`,
      pct: phasePct(PCT.savingEnd, PCT.resolveEnd, i, leads.length),
      current: i + 1,
      total: leads.length,
    });
    // Retry anything not yet resolved (unresolved AND prior no_contact) — a lead
    // marked no_contact before the fast YC-detail lookup existed can now resolve.
    if (lead.contact_status !== 'resolved') {
      const res = await resolveLeadContacts(client, workspaceId, lead, { enrich: true, fastOnly });
      if (res.status === 'resolved') result.resolved += 1;
      if (res.status === 'no_contact') result.noContact += 1;
      lead.contact_status = res.status;
    }
  }

  // Phase B (bounded-concurrent): LLM-graded ICP fit per lead. This is the
  // only step whose scheduling changes - same inputs/outputs as the prior
  // serial loop, just run with up to ICP_CONCURRENCY in flight at once.
  //
  // Per-workspace daily budget gate: each scored lead is one LLM call, and a run
  // scores up to MAX_LEADS_PER_RUN (200) leads — repeatable via "Scrape now".
  // Without a cap this alone could drain provider credits. checkAndIncrementUsage
  // enforces the workspace's daily haiku cap; once hit, remaining leads fall back
  // to the neutral 0.5 score (deterministic `fit` then dominates the blend), so
  // ranking still degrades gracefully instead of erroring.
  emit({ phase: 'scoring', label: `Scoring ${leads.length} leads for fit…`, pct: PCT.resolveEnd });
  const icpConfigured = settings.icp_verticals.length > 0 || settings.icp_keywords.length > 0;
  let scored = 0;
  const icpFits = await mapWithConcurrency(leads, ICP_CONCURRENCY, async (lead) => {
    const done = () => {
      scored += 1;
      emit({
        phase: 'scoring',
        label: `Scoring leads (${scored}/${leads.length})…`,
        pct: phasePct(PCT.resolveEnd, PCT.scoringEnd, scored, leads.length),
        current: scored,
        total: leads.length,
      });
    };
    if (!icpConfigured) {
      done();
      return 0.5;
    }
    const budget = await checkAndIncrementUsage(client, workspaceId, 'haiku');
    if (budget === 'blocked') {
      done();
      return 0.5;
    }
    const fit = await scoreIcpFit({
      companyName: lead.company_name,
      tagline: lead.tagline,
      tags: lead.tags,
      verticals: settings.icp_verticals,
      keywords: settings.icp_keywords,
    });
    done();
    return fit;
  });

  // Phase C (sequential): blend, rank, and persist. DB writes stay serial.
  emit({ phase: 'ranking', label: 'Ranking leads…', pct: PCT.scoringEnd });
  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    const fit = computeFitScore(lead, settings);
    // LLM-graded ICP fit dominates the blend; the deterministic heuristic
    // `fit` above only breaks ties (and is the sole signal when the LLM call
    // fails closed to neutral 0.5).
    const blendedFit = Number((0.7 * icpFits[i] + 0.3 * fit).toFixed(3));
    const rank = computeRankScore(lead, blendedFit, today);
    await updateLead(client, workspaceId, lead.id, { fit_score: blendedFit, rank_score: rank });
    emit({
      phase: 'ranking',
      label: `Ranking leads (${i + 1}/${leads.length})…`,
      pct: phasePct(PCT.scoringEnd, PCT.rankingEnd, i + 1, leads.length),
      current: i + 1,
      total: leads.length,
    });
  }

  emit({ phase: 'done', label: 'Done', pct: 100 });
  return result;
}

/**
 * Linearly interpolate an overall-bar percentage within a phase's [start,end]
 * band given progress `i`/`n`. Returns `start` when `n` is 0 so an empty phase
 * never divides by zero or moves the bar backwards.
 */
function phasePct(start: number, end: number, i: number, n: number): number {
  if (n <= 0) return start;
  const frac = Math.min(1, Math.max(0, i / n));
  return Math.round(start + (end - start) * frac);
}
