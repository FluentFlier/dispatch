import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import {
  DIRECTORY_QUERIES,
  LEAD_OUTPUT_SCHEMA,
  renderGoal,
} from '@/lib/signals/ingest/directory-queries';
import { SEED_DIRECTORY_LEADS } from '@/lib/signals/ingest/seed-leads';
import { signalsDebugEnabled, scrapeTimeoutMs } from '@/lib/signals/ingest/config';
import { fetchYcCompaniesViaAlgolia } from '@/lib/signals/ingest/yc-algolia';

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

// TinyFish Agent surface (synchronous variant): natural-language goal + schema →
// structured JSON. This is the unified-platform replacement for the retired
// AgentQL REST endpoint; the sk- key only authenticates against *.tinyfish.ai.
const AGENT_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';

// Agent extraction from JS-heavy directory SPAs is nondeterministic: one run can
// return 0-10 rows (the page renders lazily). So we make up to MAX_ATTEMPTS runs
// and accumulate unique companies across them, stopping early once we clear
// TARGET_FLOOR. Attempts also absorb a transient failure. Kept small — each run
// is slow (~25-130s) and metered.
const MAX_ATTEMPTS = 3;

/** Shape of a TinyFish Agent /run response (COMPLETED carries the result). */
interface AgentRunResponse {
  run_id?: string;
  status?: string;
  num_of_steps?: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
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

/**
 * Fetches structured leads for one directory via the TinyFish Agent REST
 * endpoint. We wrap REST directly (not an SDK) so we own retries, backoff, and
 * the per-directory goals (see DIRECTORY_QUERIES). When no API key is
 * configured, returns an empty array for a real workspace; the deterministic
 * seed set is returned ONLY behind the explicit SIGNALS_DEMO_SEED flag (demo /
 * offline testing), never as a silent fallback — swap in creds to go live.
 *
 * Retries to a target: because a single run is unreliable, it runs up to
 * MAX_ATTEMPTS times and accumulates unique companies across runs, breaking once
 * it clears the floor. Throws DirectoryScrapeError only if every attempt fails or
 * extracts nothing, so the caller surfaces the failure per-source (never silently 0).
 */
export async function fetchDirectoryLeads(
  source: LeadSource,
  opts?: { icpQuery?: string },
): Promise<IngestedLead[]> {
  const config = DIRECTORY_QUERIES[source];
  if (!config) throw new DirectoryScrapeError(source, `No query config for source ${source}`);

  if (!isTinyFishConfigured()) {
    // TINYFISH_API_KEY doubles as the "live scraping enabled" switch. When it is
    // absent, only the intentional demo path may return the fabricated seed set
    // (behind SIGNALS_DEMO_SEED); a real workspace instead sees a genuine empty
    // state so fictional companies with dead LinkedIn URLs never leak into a
    // real feed. The YC Algolia path below also stays gated behind the key.
    if (isDemoSeedEnabled()) {
      return SEED_DIRECTORY_LEADS.filter((l) => l.source === source);
    }
    return [];
  }

  // Hybrid ingest: YC directory comes from YC's Algolia index (deterministic,
  // fast, reliable). Other sources (Product Hunt, launches) have no clean
  // endpoint, so they use the TinyFish Agent path below.
  if (source === 'yc_directory') {
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

  const debug = signalsDebugEnabled();
  const body = JSON.stringify({
    url: config.url,
    goal: renderGoal(config),
    output_schema: LEAD_OUTPUT_SCHEMA,
  });

  const timeoutMs = scrapeTimeoutMs();
  // Stop retrying once we hold at least this many unique companies: a good first
  // run exits immediately; only empty/thin runs pay for extra attempts.
  const targetFloor = Math.min(config.maxCompanies, 5);
  const collected = new Map<string, IngestedLead>();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    // Bound each attempt: agent runs are slow/variable, so a hung request must
    // fail fast (and retry) rather than stall until Node's 300s socket timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(AGENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.TINYFISH_API_KEY!.trim(),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`TinyFish ${res.status}: ${await res.text()}`);

      const payload = (await res.json()) as AgentRunResponse;
      // A 200 can still carry a failed run — treat anything but COMPLETED as an error.
      if (payload.status !== 'COMPLETED' || payload.error) {
        throw new Error(
          `TinyFish run ${payload.status ?? 'unknown'}: ${payload.error ?? 'no result returned'}`,
        );
      }

      const { listKey, rows } = pickCompanyRows(payload.result ?? {});
      const leads = normalizeAgentResult(source, payload.result ?? {});
      // Dedupe across attempts by external_id (runs return overlapping subsets).
      for (const lead of leads) collected.set(lead.externalId, lead);

      if (debug) {
        // Diagnostic reasoning (removable): distinguishes an agent that returned
        // few rows from a normalizer that dropped them. If rawRows >> companies,
        // the mapping is discarding rows; if rawRows is itself tiny, the agent
        // under-extracted (page render / goal / variance) and we retry.
        console.log(
          `[tinyfish] ${source} v${config.version} attempt=${attempt}/${MAX_ATTEMPTS} ` +
            `run=${payload.run_id ?? '?'} status=${payload.status} steps=${payload.num_of_steps ?? '?'} ` +
            `listKey=${listKey ?? 'none'} rawRows=${rows.length} companies=${leads.length} ` +
            `total=${collected.size} in ${Date.now() - startedAt}ms`,
        );
        if (rows.length > leads.length) {
          const dropped = rows.find(
            (r) => !String(r.company_name ?? '').trim() || !String(r.external_id ?? r.company_name ?? '').trim(),
          );
          console.warn(
            `[tinyfish] ${source} normalizer dropped ${rows.length - leads.length} row(s) ` +
              `(missing company_name/external_id). sample=${JSON.stringify(dropped)}`,
          );
        }
      }

      if (collected.size >= targetFloor) break;
      // Under-extracted (common on lazy SPAs) — fall through and try again.
    } catch (err) {
      lastErr = err;
      if (debug) {
        console.warn(
          `[tinyfish] ${source} attempt ${attempt}/${MAX_ATTEMPTS} failed after ` +
            `${Date.now() - startedAt}ms: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
    // Brief backoff before another attempt (deterministic; skipped after the last).
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000));
  }

  if (collected.size > 0) return Array.from(collected.values());
  throw new DirectoryScrapeError(
    source,
    `No companies extracted after ${MAX_ATTEMPTS} attempts`,
    lastErr,
  );
}

/**
 * Maps a TinyFish Agent result into normalized IngestedLead rows. Reads the
 * `companies` array (the schema's standardized key); tolerates an alternate
 * top-level array key so a goal that emits `products`/`launches` still parses.
 */
function normalizeAgentResult(
  source: LeadSource,
  result: Record<string, unknown>,
): IngestedLead[] {
  const { rows } = pickCompanyRows(result);

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

/**
 * Locates the array of company/product rows in an Agent result. Prefers the
 * schema's standardized `companies` key; falls back to the first array-valued
 * key so a goal that emits `products`/`launches` still parses. Shared by the
 * normalizer and the debug diagnostics so both see the same rows.
 */
function pickCompanyRows(result: Record<string, unknown>): {
  listKey: string | undefined;
  rows: Array<Record<string, unknown>>;
} {
  const listKey = Array.isArray(result.companies)
    ? 'companies'
    : Object.keys(result).find((k) => Array.isArray(result[k]));
  const rows = (listKey ? (result[listKey] as unknown[]) : []) as Array<Record<string, unknown>>;
  return { listKey, rows };
}
