import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { DIRECTORY_QUERIES } from '@/lib/signals/ingest/directory-queries';
import { SEED_DIRECTORY_LEADS } from '@/lib/signals/ingest/seed-leads';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { isLlmConfigured } from '@/lib/llm';
import { fetchYcCompaniesViaAlgolia, fetchYcLaunchesViaAlgolia } from '@/lib/signals/ingest/yc-algolia';
import { tinyfishFetch } from '@/lib/signals/ingest/tinyfish-web';
import { extractCompanyLeads, MAX_PAGE_CHARS } from '@/lib/signals/ingest/extract-companies';
import type { DiscoveryContext } from '@/lib/signals/ingest/lead-sources/types';

/** Thrown when a directory scrape fails after retries so callers isolate per-source. */
export class DirectoryScrapeError extends Error {
  constructor(
    public readonly source: LeadSource,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DirectoryScrapeError';
  }
}

/** True when live TinyFish credentials are configured. */
export function isTinyFishConfigured(): boolean {
  return Boolean(process.env.TINYFISH_API_KEY?.trim());
}

/**
 * True only when the demo-seed switch is explicitly on. The fabricated
 * SEED_DIRECTORY_LEADS set (fictional companies with dead LinkedIn URLs) must
 * NEVER leak into a real workspace feed, so it is returned only behind this
 * explicit flag, never as a silent fallback for a missing scraper key.
 */
export function isDemoSeedEnabled(): boolean {
  return process.env.SIGNALS_DEMO_SEED === '1';
}

/** Listing text can hold many products; give the extractor a larger slice than a web page. */
const DIRECTORY_TEXT_CHARS = MAX_PAGE_CHARS * 3;

/**
 * Fetches structured leads for one directory.
 *
 * - yc_directory: served by YC's own public Algolia index (keyless, ~300ms,
 *   deterministic) - see yc-algolia.ts. Runs whether or not a TinyFish key is
 *   present; only the demo-seed flag short-circuits it to fabricated data.
 * - Other directories (Product Hunt, YC Launches): TinyFish Fetch renders the
 *   listing page (Chromium, JS/SPA aware, ~1-2s) and the shared extractor pulls
 *   every listed company. This replaces the retired TinyFish Agent path, whose
 *   browser-automation runs took 200s+ per SPA and blew the function budget.
 *
 * When no TinyFish key is configured, non-YC sources return [] for a real
 * workspace; the deterministic seed set is returned ONLY behind SIGNALS_DEMO_SEED
 * (demo / offline testing). Throws DirectoryScrapeError so the caller surfaces the
 * failure per-source (never silently 0).
 */
export async function fetchDirectoryLeads(
  source: LeadSource,
  opts?: { icpQuery?: string },
): Promise<IngestedLead[]> {
  const config = DIRECTORY_QUERIES[source];
  if (!config) throw new DirectoryScrapeError(source, `No query config for source ${source}`);

  if (source === 'yc_directory') {
    if (!isTinyFishConfigured() && isDemoSeedEnabled()) {
      return SEED_DIRECTORY_LEADS.filter((l) => l.source === source);
    }
    try {
      const leads = await fetchYcCompaniesViaAlgolia(config.maxCompanies, opts?.icpQuery ?? '');
      if (leads.length > 0) return leads;
      throw new Error('Algolia returned 0 companies');
    } catch (err) {
      if (err instanceof DirectoryScrapeError) throw err;
      throw new DirectoryScrapeError(
        source,
        `YC Algolia fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // YC Launches: served by YC's own Launches Algolia index (keyless, like
  // yc_directory) - the /launches SPA can't be read by Fetch or the Agent.
  if (source === 'yc_launches') {
    try {
      const leads = await fetchYcLaunchesViaAlgolia(config.maxCompanies, opts?.icpQuery ?? '');
      if (leads.length > 0) return leads;
      throw new Error('Launches Algolia returned 0 launches');
    } catch (err) {
      if (err instanceof DirectoryScrapeError) throw err;
      throw new DirectoryScrapeError(
        source,
        `YC Launches fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // Fetch-driven sources (Product Hunt).
  if (!isTinyFishConfigured()) {
    if (isDemoSeedEnabled()) return SEED_DIRECTORY_LEADS.filter((l) => l.source === source);
    return [];
  }
  if (!isLlmConfigured()) {
    throw new DirectoryScrapeError(source, 'LLM not configured - cannot extract companies from fetched page');
  }

  let pageText: string;
  try {
    const pages = await tinyfishFetch([config.url]);
    pageText = pages[0]?.text ?? '';
  } catch (err) {
    throw new DirectoryScrapeError(
      source,
      `TinyFish Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  if (!pageText) throw new DirectoryScrapeError(source, 'Fetch returned no page text');

  const ctx: DiscoveryContext = {
    icpDescription: null,
    icpVerticals: [],
    icpKeywords: [],
    icpQuery: opts?.icpQuery ?? '',
    maxLeads: config.maxCompanies,
  };
  const leads = await extractCompanyLeads(
    ctx,
    source,
    { pages: `--- Page: ${config.url} ---\n${pageText.slice(0, DIRECTORY_TEXT_CHARS)}` },
    { mode: 'all' },
  );

  if (signalsDebugEnabled()) {
    console.log(`[tinyfish-fetch] ${source} v${config.version} -> ${leads.length} companies`);
  }
  if (leads.length > 0) return leads;
  throw new DirectoryScrapeError(source, 'No companies extracted from fetched page');
}
