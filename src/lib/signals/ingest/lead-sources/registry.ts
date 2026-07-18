import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { webDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/web-discovery';
import { directoryAdapters, DirectoryScrapeError } from '@/lib/signals/ingest/lead-sources/directories';
import { socialAdapters } from '@/lib/signals/ingest/lead-sources/social-discovery';
import type {
  LeadDiscoveryAdapter,
  RunLeadDiscoveryInput,
  RunLeadDiscoveryResult,
} from '@/lib/signals/ingest/lead-sources/types';

/** All registered adapters keyed by source. `manual` is watchlist-only - no adapter. */
export const LEAD_DISCOVERY_ADAPTERS: Partial<Record<LeadSource, LeadDiscoveryAdapter>> =
  Object.fromEntries(
    [webDiscoveryAdapter, ...directoryAdapters, ...socialAdapters].map((a) => [a.source, a]),
  );

/** Ordered list for stable execution (ICP first, then directories, then social). */
export const ALL_DISCOVERY_ADAPTERS: LeadDiscoveryAdapter[] = [
  webDiscoveryAdapter,
  ...directoryAdapters,
  ...socialAdapters,
];

export function getDiscoveryAdapter(source: LeadSource): LeadDiscoveryAdapter | undefined {
  return LEAD_DISCOVERY_ADAPTERS[source];
}

/**
 * Central lead discovery orchestrator. Runs each enabled adapter in isolation;
 * failures are captured per-source so one bad scrape never kills the run.
 */
export async function runLeadDiscovery(input: RunLeadDiscoveryInput): Promise<RunLeadDiscoveryResult> {
  const debug = signalsDebugEnabled();
  const enabled = new Set(input.enabledSources);

  // Filter to the adapters that will actually run (enabled + configured + ICP
  // present for web_discovery) BEFORE spawning, so progress indices are stable.
  const toRun = ALL_DISCOVERY_ADAPTERS.filter((adapter) => {
    if (!enabled.has(adapter.source)) return false;
    if (!adapter.isAvailable()) {
      if (debug) console.log(`[lead-discovery] ${adapter.source} skipped - not configured`);
      return false;
    }
    if (
      adapter.source === 'web_discovery' &&
      !input.icpDescription?.trim() &&
      !input.icpQuery.trim()
    ) {
      if (debug) console.log('[lead-discovery] web_discovery skipped - no ICP');
      return false;
    }
    return true;
  });

  // Run every source CONCURRENTLY. They are independent, and with the Search/Fetch
  // paths each returns in ~1-2s - so a slow source no longer serializes behind the
  // others or starves the function budget. Failures are isolated per-source: a
  // rejected adapter becomes an error entry, never taking down the run.
  const settled = await Promise.all(
    toRun.map(async (adapter, i) => {
      input.onAdapterStart?.(adapter.source, i, toRun.length);
      try {
        const leads = await adapter.discover({
          icpDescription: input.icpDescription,
          icpVerticals: input.icpVerticals,
          icpKeywords: input.icpKeywords,
          icpQuery: input.icpQuery,
          discoveryGoal: input.discoveryGoal ?? null,
          maxLeads: input.maxLeads,
        });
        return { adapter, leads };
      } catch (err) {
        const msg =
          err instanceof DirectoryScrapeError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        return { adapter, error: msg };
      }
    }),
  );

  // Merge in stable adapter order so cross-source dedupe (by externalId) is
  // deterministic regardless of which source's request finished first.
  const collected = new Map<string, IngestedLead>();
  const perSource: RunLeadDiscoveryResult['perSource'] = [];
  const warnings: string[] = [];

  for (const r of settled) {
    if ('error' in r) {
      perSource.push({ source: r.adapter.source, count: 0, error: r.error });
      warnings.push(`${r.adapter.source} failed: ${r.error}`);
      console.error(`[lead-discovery] ${r.adapter.source} failed:`, r.error);
      continue;
    }
    for (const lead of r.leads) collected.set(lead.externalId, lead);
    perSource.push({ source: r.adapter.source, count: r.leads.length });
    if (debug) console.log(`[lead-discovery] ${r.adapter.source} → ${r.leads.length}`);
  }

  return {
    leads: Array.from(collected.values()).slice(0, input.maxLeads),
    perSource,
    warnings,
  };
}
