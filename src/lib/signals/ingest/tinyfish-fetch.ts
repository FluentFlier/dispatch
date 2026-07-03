import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { DIRECTORY_QUERIES } from '@/lib/signals/ingest/directory-queries';
import { SEED_DIRECTORY_LEADS } from '@/lib/signals/ingest/seed-leads';

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

const AGENTQL_ENDPOINT = 'https://api.agentql.com/v1/query-data';
const MAX_RETRIES = 3;

/** True when live TinyFish/AgentQL credentials are configured. */
export function isTinyFishConfigured(): boolean {
  return Boolean(process.env.TINYFISH_API_KEY?.trim());
}

/**
 * Fetches structured leads for one directory via the AgentQL REST endpoint.
 * We wrap REST directly (not the SDK) so we own retries, backoff, and the
 * per-directory query strings (see DIRECTORY_QUERIES). When no API key is
 * configured, falls back to a deterministic seed set so the full pipeline is
 * testable end-to-end without live scraping — swap in creds to go live.
 */
export async function fetchDirectoryLeads(source: LeadSource): Promise<IngestedLead[]> {
  const config = DIRECTORY_QUERIES[source];
  if (!config) throw new DirectoryScrapeError(source, `No query config for source ${source}`);

  if (!isTinyFishConfigured()) {
    // Seed path: exercises dedupe/rename/resolve/score/draft without live TinyFish.
    return SEED_DIRECTORY_LEADS.filter((l) => l.source === source);
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(AGENTQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.TINYFISH_API_KEY!.trim(),
        },
        body: JSON.stringify({ url: config.url, query: config.query }),
      });
      if (!res.ok) throw new Error(`AgentQL ${res.status}: ${await res.text()}`);
      const payload = (await res.json()) as { data?: Record<string, unknown> };
      return normalizeAgentqlPayload(source, payload.data ?? {});
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        // Exponential backoff (deterministic; no jitter needed server-side).
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw new DirectoryScrapeError(source, `Scrape failed after ${MAX_RETRIES} attempts`, lastErr);
}

/** Maps a raw AgentQL response into normalized IngestedLead rows. */
function normalizeAgentqlPayload(
  source: LeadSource,
  data: Record<string, unknown>,
): IngestedLead[] {
  const listKey = Object.keys(data).find((k) => Array.isArray(data[k]));
  const rows = (listKey ? (data[listKey] as unknown[]) : []) as Array<Record<string, unknown>>;

  return rows
    .map((r): IngestedLead | null => {
      const companyName = String(r.company_name ?? '').trim();
      const externalId = String(r.external_id ?? companyName).trim();
      if (!companyName || !externalId) return null;
      const foundersRaw = (r.founders ?? r.makers ?? []) as Array<Record<string, unknown>>;
      return {
        source,
        externalId,
        companyName,
        tagline: r.tagline ? String(r.tagline) : undefined,
        website: r.website ? String(r.website) : undefined,
        batch: r.batch ? String(r.batch) : undefined,
        tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
        founders: foundersRaw.map((f) => ({
          name: f.name ? String(f.name) : undefined,
          role: f.role ? String(f.role) : undefined,
          linkedinUrl: f.linkedin_url ? String(f.linkedin_url) : undefined,
          xHandle: f.x_handle ? String(f.x_handle) : undefined,
        })),
      };
    })
    .filter((l): l is IngestedLead => l !== null);
}
