import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchDirectoryLeads,
  isTinyFishConfigured,
  DirectoryScrapeError,
} from '@/lib/signals/ingest/tinyfish-fetch';
import { SEED_DIRECTORY_LEADS } from '@/lib/signals/ingest/seed-leads';
import { decideContactStatus } from '@/lib/signals/leads/identity';

/** Builds a fetch Response-like stub for the TinyFish Agent /run endpoint. */
function agentResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response {
  const text = JSON.stringify(body);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.status === 401 ? 'Unauthorized' : 'OK',
    json: async () => JSON.parse(text),
    text: async () => text,
  } as Response;
}

describe('Phase: Directory ingest (seed provider)', () => {
  const prevKey = process.env.TINYFISH_API_KEY;
  beforeEach(() => {
    delete process.env.TINYFISH_API_KEY;
  });
  afterEach(() => {
    if (prevKey !== undefined) process.env.TINYFISH_API_KEY = prevKey;
  });

  it('is not configured without an API key (seed path active)', () => {
    expect(isTinyFishConfigured()).toBe(false);
  });

  it('returns the YC seed set when TinyFish is unconfigured', async () => {
    const leads = await fetchDirectoryLeads('yc_directory');
    expect(leads.length).toBe(SEED_DIRECTORY_LEADS.filter((l) => l.source === 'yc_directory').length);
    expect(leads.every((l) => l.source === 'yc_directory')).toBe(true);
    expect(leads.every((l) => l.companyName && l.externalId)).toBe(true);
  });

  it('returns the Product Hunt seed set (Phase 9 source)', async () => {
    const leads = await fetchDirectoryLeads('product_hunt');
    expect(leads.length).toBe(SEED_DIRECTORY_LEADS.filter((l) => l.source === 'product_hunt').length);
    expect(leads.every((l) => l.source === 'product_hunt')).toBe(true);
  });

  it('seed mix produces both resolvable and no_contact leads (exercises every branch)', () => {
    const statuses = SEED_DIRECTORY_LEADS.map((l) =>
      decideContactStatus(
        (l.founders ?? []).map((f) => ({ linkedin_url: f.linkedinUrl ?? null, x_handle: f.xHandle ?? null, role: f.role ?? null })),
      ).status,
    );
    expect(statuses).toContain('resolved');
    expect(statuses).toContain('no_contact');
  });
});

describe('Phase: Directory ingest (live TinyFish Agent path)', () => {
  const prevKey = process.env.TINYFISH_API_KEY;
  beforeEach(() => {
    process.env.TINYFISH_API_KEY = 'sk-test-key';
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = prevKey;
    vi.restoreAllMocks();
  });

  /** A COMPLETED run carrying N synthetic companies (external_id c0..c{N-1}). */
  function completedRun(n: number): Response {
    return agentResponse({
      run_id: 'r',
      status: 'COMPLETED',
      error: null,
      result: {
        companies: Array.from({ length: n }, (_, i) => ({
          external_id: `c${i}`,
          company_name: `Co ${i}`,
          tagline: 't',
          batch: 'W2009',
          tags: ['travel'],
          founders: i === 0 ? [{ name: 'Brian', role: 'CEO', linkedin_url: 'https://li/brian' }] : [],
        })),
      },
    });
  }

  // product_hunt uses the agent path (yc_directory now uses the Algolia path).
  it('normalizes a COMPLETED Agent run and breaks on the first sufficient run', async () => {
    // 6 companies clears the target floor (5) → exactly one agent call.
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(completedRun(6));

    const leads = await fetchDirectoryLeads('product_hunt');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'https://agent.tinyfish.ai/v1/automation/run',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(leads).toHaveLength(6);
    expect(leads[0]).toMatchObject({ source: 'product_hunt', externalId: 'c0', companyName: 'Co 0' });
    expect(leads[0].founders?.[0]).toMatchObject({ name: 'Brian', linkedinUrl: 'https://li/brian' });
  });

  // Reliability regression: a single agent run is nondeterministic (0-10 rows).
  // An empty run must NOT end the scrape — the next attempt should recover.
  it('retries past an empty run and accumulates unique companies', async () => {
    const spy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(completedRun(0)) // attempt 1: agent under-extracts
      .mockResolvedValueOnce(completedRun(6)); // attempt 2: recovers

    const leads = await fetchDirectoryLeads('product_hunt');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(leads).toHaveLength(6);
  });

  // Regression: a 401 (wrong key) must SURFACE as a thrown DirectoryScrapeError,
  // not be silently normalized into 0 leads. This is the original silent-failure bug.
  it('throws DirectoryScrapeError on a 401 (never swallows into 0 leads)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      agentResponse({ error_info: 'API Key not found' }, { ok: false, status: 401 }),
    );
    await expect(fetchDirectoryLeads('product_hunt')).rejects.toBeInstanceOf(DirectoryScrapeError);
  });

  // Regression: a 200 carrying a FAILED run is still a failure, not empty success.
  it('throws when the run status is not COMPLETED', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      agentResponse({ run_id: 'r2', status: 'FAILED', error: 'navigation timeout', result: null }),
    );
    await expect(fetchDirectoryLeads('product_hunt')).rejects.toBeInstanceOf(DirectoryScrapeError);
  });
});

describe('Phase: Directory ingest (YC Algolia path)', () => {
  const prevKey = process.env.TINYFISH_API_KEY;
  beforeEach(() => {
    process.env.TINYFISH_API_KEY = 'sk-test-key';
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = prevKey;
    vi.restoreAllMocks();
  });

  const YC_PAGE_HTML =
    '<html><script>window.AlgoliaOpts = {"app":"TESTAPP","key":"testkey"};</script></html>';

  function textResponse(body: string): Response {
    return { ok: true, status: 200, statusText: 'OK', text: async () => body } as Response;
  }
  function jsonResponse(obj: unknown): Response {
    const t = JSON.stringify(obj);
    return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(t), text: async () => t } as Response;
  }

  it('reads AlgoliaOpts from the YC page and maps Algolia hits to leads', async () => {
    const spy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(textResponse(YC_PAGE_HTML)) // 1st fetch: YC page
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              hits: [
                { slug: 'acme', name: 'Acme', one_liner: 'We do X', website: 'https://acme.com', batch_name: 'W2024', industries: ['AI'] },
                { slug: 'beta', name: 'Beta', one_liner: 'We do Y', website: 'https://beta.io', batch_name: 'S2024', industries: ['Fintech'] },
              ],
            },
          ],
        }),
      );

    const leads = await fetchDirectoryLeads('yc_directory');
    // 2nd fetch hits the Algolia endpoint derived from the page's app id.
    expect(spy).toHaveBeenNthCalledWith(
      2,
      'https://testapp-dsn.algolia.net/1/indexes/*/queries',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({
      source: 'yc_directory',
      externalId: 'acme',
      companyName: 'Acme',
      website: 'https://acme.com',
      batch: 'W2024',
    });
    expect(leads[0].founders).toEqual([]);
  });

  it('throws DirectoryScrapeError when AlgoliaOpts is missing (YC layout changed)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(textResponse('<html>no opts here</html>'));
    await expect(fetchDirectoryLeads('yc_directory')).rejects.toBeInstanceOf(DirectoryScrapeError);
  });
});
