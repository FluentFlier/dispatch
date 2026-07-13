import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { webDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/web-discovery';
import { directoryAdapters, DirectoryScrapeError } from '@/lib/signals/ingest/lead-sources/directories';
import { socialAdapters } from '@/lib/signals/ingest/lead-sources/social-stubs';
import type {
  LeadDiscoveryAdapter,
  RunLeadDiscoveryInput,
  RunLeadDiscoveryResult,
} from '@/lib/signals/ingest/lead-sources/types';

/** All registered adapters keyed by source. `manual` is watchlist-only — no adapter. */
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
  const toRun = ALL_DISCOVERY_ADAPTERS.filter((a) => enabled.has(a.source));
  const collected = new Map<string, IngestedLead>();

  const perSource: RunLeadDiscoveryResult['perSource'] = [];
  const warnings: string[] = [];

  for (let i = 0; i < toRun.length; i += 1) {
    const adapter = toRun[i];
    input.onAdapterStart?.(adapter.source, i, toRun.length);

    if (!adapter.isAvailable()) {
      if (debug) console.log(`[lead-discovery] ${adapter.source} skipped — not configured`);
      continue;
    }

    // Web discovery requires ICP context.
    if (
      adapter.source === 'web_discovery' &&
      !input.icpDescription?.trim() &&
      !input.icpQuery.trim()
    ) {
      if (debug) console.log('[lead-discovery] web_discovery skipped — no ICP');
      continue;
    }

    try {
      const leads = await adapter.discover({
        icpDescription: input.icpDescription,
        icpVerticals: input.icpVerticals,
        icpKeywords: input.icpKeywords,
        icpQuery: input.icpQuery,
        maxLeads: input.maxLeads,
      });
      for (const lead of leads) {
        collected.set(lead.externalId, lead);
      }
      perSource.push({ source: adapter.source, count: leads.length });
      if (debug) console.log(`[lead-discovery] ${adapter.source} → ${leads.length}`);
    } catch (err) {
      const msg =
        err instanceof DirectoryScrapeError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      perSource.push({ source: adapter.source, count: 0, error: msg });
      warnings.push(`${adapter.source} failed: ${msg}`);
      console.error(`[lead-discovery] ${adapter.source} failed:`, msg);
    }
  }

  return {
    leads: Array.from(collected.values()).slice(0, input.maxLeads),
    perSource,
    warnings,
  };
}
