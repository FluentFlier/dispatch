/** Signals ingest strategy (separate from Hook Intelligence Apify mining). */

export type SignalsIngestMode = 'webhook' | 'unipile' | 'apify' | 'auto';

export function getSignalsIngestMode(): SignalsIngestMode {
  const raw = process.env.SIGNALS_INGEST_MODE?.toLowerCase();
  if (raw === 'webhook' || raw === 'unipile' || raw === 'apify') return raw;
  return 'auto';
}

export function signalsApifyEnabled(): boolean {
  if (process.env.SIGNALS_USE_APIFY === 'false') return false;
  if (process.env.SIGNALS_USE_APIFY === 'true') return Boolean(process.env.APIFY_TOKEN);
  // Auto: Apify only when explicitly opted in for Signals (Hook Intelligence uses USE_APIFY separately)
  return false;
}

/** Max posts fetched per source per poll (cost guard). */
export const SIGNALS_MAX_POSTS_PER_SOURCE = Math.min(
  Number(process.env.SIGNALS_MAX_POSTS_PER_SOURCE ?? 5) || 5,
  15,
);

export function getIngestSecret(): string | undefined {
  return process.env.SIGNALS_INGEST_SECRET?.trim() || process.env.CRON_SECRET?.trim();
}

/**
 * True when verbose Signals ingest logging is enabled (SIGNALS_DEBUG=true|1).
 * Gates the per-source scrape diagnostics (endpoint, run_id, status, counts,
 * timing) so the directory pipeline is observable without a debugger, yet quiet
 * in normal runs. Off by default.
 */
export function signalsDebugEnabled(): boolean {
  const raw = process.env.SIGNALS_DEBUG?.toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * Whether the batch directory sync runs per-lead contact enrichment inline.
 * Enrichment is a full TinyFish Agent run (~60s) PER lead, so a batch scrape of
 * N leads would take N×60s and blow the request/function timeout. Off by default:
 * the batch scrape stays fast (scraped-URL leads resolve, the rest land
 * no_contact) and enrichment happens on demand via the single-lead "Try to
 * resolve" action. Set SIGNALS_ENRICH_INLINE=true only for small/offline runs.
 */
export function signalsEnrichInlineEnabled(): boolean {
  const raw = process.env.SIGNALS_ENRICH_INLINE?.toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * Per-attempt timeout (ms) for a TinyFish Agent scrape run. Agent latency is
 * high and variable (~60-130s); this bounds a hung request so it fails fast and
 * retries instead of stalling until Node's 300s socket timeout. Kept under the
 * serverless function cap so two attempts still fit. Tunable via
 * SIGNALS_SCRAPE_TIMEOUT_MS.
 */
export function scrapeTimeoutMs(): number {
  const n = Number(process.env.SIGNALS_SCRAPE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 170_000;
}
