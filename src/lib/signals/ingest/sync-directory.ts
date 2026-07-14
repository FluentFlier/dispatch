import type { createClient } from '@insforge/sdk';
import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { icpToSearchQuery } from '@/lib/signals/icp/parse-description';
import { runLeadDiscovery } from '@/lib/signals/ingest/lead-sources';
import {
  getDirectorySettings,
  ensureDirectorySourcesEnabled,
  getLead,
  updateLead,
  upsertIngestedLeads,
} from '@/lib/signals/leads/store';
import { resolveLeadContacts } from '@/lib/signals/leads/resolve-contact';
import { computeFitScore, computeRankScore } from '@/lib/signals/leads/score';
import { scoreIcpFit } from '@/lib/signals/leads/icp-score';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { signalsDebugEnabled, signalsEnrichInlineEnabled } from '@/lib/signals/ingest/config';
import { defaultEnabledSources } from '@/lib/signals/leads/directory-defaults';
import { mapWithConcurrency } from '@/lib/util/concurrency';

type InsforgeClient = ReturnType<typeof createClient>;

const MAX_LEADS_PER_RUN = 200;
/** Cap batch contact resolution so sync stays within the function timeout. */
const MAX_BATCH_RESOLVE = 40;

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
 * One directory sync for a workspace: run each enabled discovery adapter
 * (web, directories, social - failures isolated per-source), upsert with rename
 * detection, resolve contacts, then re-score every lead.
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
  const settings = await ensureDirectorySourcesEnabled(client, workspaceId);
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

  const icpQuery = icpToSearchQuery(
    settings.icp_verticals ?? [],
    settings.icp_keywords ?? [],
    settings.icp_description,
  );
  const activeSources =
    settings.enabled_sources.length > 0
      ? settings.enabled_sources
      : defaultEnabledSources();

  emit({ phase: 'discovery', label: 'Discovering leads…', pct: PCT.scrapeStart });

  const discovery = await runLeadDiscovery({
    enabledSources: activeSources,
    icpDescription: settings.icp_description,
    icpVerticals: settings.icp_verticals ?? [],
    icpKeywords: settings.icp_keywords ?? [],
    icpQuery,
    maxLeads: MAX_LEADS_PER_RUN,
    onAdapterStart: (source, index, total) => {
      emit({
        phase: 'scraping',
        label: `Discovering via ${source.replace(/_/g, ' ')}…`,
        pct: phasePct(PCT.scrapeStart, PCT.scrapeEnd, index, total),
        current: index,
        total,
      });
    },
  });

  const collected: IngestedLead[] = discovery.leads;
  result.perSource.push(...discovery.perSource);
  result.warnings.push(...discovery.warnings);

  emit({ phase: 'discovery', label: 'Discovery complete', pct: PCT.scrapeEnd });

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

  const fastOnly = !signalsEnrichInlineEnabled();
  const resolveIds = upsert.leadIds.slice(0, MAX_BATCH_RESOLVE);
  const leads = (
    await Promise.all(resolveIds.map((id) => getLead(client, workspaceId, id)))
  ).filter((l): l is NonNullable<typeof l> => l !== null);

  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    emit({
      phase: 'resolving',
      label: `Finding contacts (${i + 1}/${leads.length})…`,
      pct: phasePct(PCT.savingEnd, PCT.resolveEnd, i, leads.length),
      current: i + 1,
      total: leads.length,
    });
    if (lead.contact_status !== 'resolved') {
      const res = await resolveLeadContacts(client, workspaceId, lead, { enrich: true, fastOnly });
      if (res.status === 'resolved') result.resolved += 1;
      if (res.status === 'no_contact') result.noContact += 1;
      lead.contact_status = res.status;
    }
  }

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

  emit({ phase: 'ranking', label: 'Ranking leads…', pct: PCT.scoringEnd });
  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    const fit = computeFitScore(lead, settings);
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

function phasePct(start: number, end: number, i: number, n: number): number {
  if (n <= 0) return start;
  const frac = Math.min(1, Math.max(0, i / n));
  return Math.round(start + (end - start) * frac);
}
