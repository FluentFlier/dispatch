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
