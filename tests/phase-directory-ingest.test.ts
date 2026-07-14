import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchDirectoryLeads,
  isTinyFishConfigured,
  DirectoryScrapeError,
} from '@/lib/signals/ingest/tinyfish-fetch';
import { SEED_DIRECTORY_LEADS } from '@/lib/signals/ingest/seed-leads';
import { fetchYcFounders, fetchYcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';
import { decideContactStatus } from '@/lib/signals/leads/identity';

// Directory extraction (Product Hunt / YC Launches) runs an LLM over the fetched
// page text. Mock it so the fetch-path tests are deterministic; individual tests
// override the return via vi.mocked(chatCompletion).mockResolvedValueOnce(...).
vi.mock('@/lib/llm', () => ({
  isLlmConfigured: () => true,
  chatCompletion: vi.fn(async () =>
    JSON.stringify({
      companies: [
        { company_name: 'Lumen', website: 'https://lumen.so', tagline: 'AI notes', tags: ['AI'] },
        { company_name: 'Harbor', website: 'https://harbor.app', tagline: 'CRM', tags: ['CRM'] },
      ],
    }),
  ),
}));
import { chatCompletion } from '@/lib/llm';

/** A TinyFish Fetch response carrying rendered page `text` for one URL. */
function fetchPageResponse(text: string, init: { ok?: boolean; status?: number } = {}): Response {
  const body = { results: [{ url: 'https://www.producthunt.com/', text }] };
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.status && init.status >= 400 ? 'Error' : 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('Phase: Directory ingest (seed provider, demo flag ON)', () => {
  const prevKey = process.env.TINYFISH_API_KEY;
  const prevSeed = process.env.SIGNALS_DEMO_SEED;
  beforeEach(() => {
    delete process.env.TINYFISH_API_KEY;
    // Seed data is demo-only: it may only appear behind the explicit flag.
    process.env.SIGNALS_DEMO_SEED = '1';
  });
  afterEach(() => {
    if (prevKey !== undefined) process.env.TINYFISH_API_KEY = prevKey;
    else delete process.env.TINYFISH_API_KEY;
    if (prevSeed !== undefined) process.env.SIGNALS_DEMO_SEED = prevSeed;
    else delete process.env.SIGNALS_DEMO_SEED;
  });

  it('is not configured without an API key', () => {
    expect(isTinyFishConfigured()).toBe(false);
  });

  it('returns the YC seed set when unconfigured AND the demo flag is on', async () => {
    const leads = await fetchDirectoryLeads('yc_directory');
    expect(leads.length).toBe(SEED_DIRECTORY_LEADS.filter((l) => l.source === 'yc_directory').length);
    expect(leads.every((l) => l.source === 'yc_directory')).toBe(true);
    expect(leads.every((l) => l.companyName && l.externalId)).toBe(true);
  });

  it('returns the Product Hunt seed set behind the demo flag (Phase 9 source)', async () => {
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

describe('Phase: Directory ingest (no key, demo flag OFF)', () => {
  const prevKey = process.env.TINYFISH_API_KEY;
  const prevSeed = process.env.SIGNALS_DEMO_SEED;
  beforeEach(() => {
    // The real-user default: no scraper key configured, no demo flag.
    delete process.env.TINYFISH_API_KEY;
    delete process.env.SIGNALS_DEMO_SEED;
  });
  afterEach(() => {
    if (prevKey !== undefined) process.env.TINYFISH_API_KEY = prevKey;
    else delete process.env.TINYFISH_API_KEY;
    if (prevSeed !== undefined) process.env.SIGNALS_DEMO_SEED = prevSeed;
    else delete process.env.SIGNALS_DEMO_SEED;
    vi.restoreAllMocks();
  });

  const YC_PAGE_HTML =
    '<html><script>window.AlgoliaOpts = {"app":"TESTAPP","key":"testkey"};</script></html>';
  const textResponse = (body: string): Response =>
    ({ ok: true, status: 200, statusText: 'OK', text: async () => body }) as Response;
  const jsonResponse = (obj: unknown): Response => {
    const t = JSON.stringify(obj);
    return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(t), text: async () => t } as Response;
  };

  // Core bug fix: YC directory is a keyless public Algolia index, so a workspace
  // with NO TinyFish key must still get real YC leads - not an empty feed.
  it('fetches real YC leads via keyless Algolia even without a TinyFish key', async () => {
    expect(isTinyFishConfigured()).toBe(false);
    const spy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(textResponse(YC_PAGE_HTML))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ hits: [{ slug: 'acme', name: 'Acme', one_liner: 'We do X', website: 'https://acme.com', batch_name: 'W2024', industries: ['AI'] }] }],
        }),
      );

    const leads = await fetchDirectoryLeads('yc_directory');
    expect(spy).toHaveBeenNthCalledWith(
      2,
      'https://testapp-dsn.algolia.net/1/indexes/*/queries',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source: 'yc_directory', externalId: 'acme', companyName: 'Acme' });
    // No fabricated seed company ever leaks in from the keyless path.
    expect(leads.some((l) => l.companyName === 'Verdant')).toBe(false);
  });

  it('returns [] for product_hunt (agent source, needs the key) when the demo flag is off', async () => {
    const leads = await fetchDirectoryLeads('product_hunt');
    expect(leads).toEqual([]);
  });
});

describe('Phase: Directory ingest (live Fetch + extract path)', () => {
  const prevKey = process.env.TINYFISH_API_KEY;
  beforeEach(() => {
    process.env.TINYFISH_API_KEY = 'sk-test-key';
    vi.mocked(chatCompletion).mockClear();
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = prevKey;
    vi.restoreAllMocks();
  });

  // product_hunt now uses TinyFish Fetch (render the listing) + LLM extract
  // (yc_directory uses the Algolia path; the slow Agent path was retired).
  it('renders the listing via Fetch and extracts every listed company', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(
      fetchPageResponse('Lumen - AI notes.  Harbor - vertical CRM.'),
    );

    const leads = await fetchDirectoryLeads('product_hunt');
    expect(spy).toHaveBeenCalledWith(
      'https://api.fetch.tinyfish.ai',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.source === 'product_hunt')).toBe(true);
    expect(leads[0]).toMatchObject({ companyName: 'Lumen', website: 'https://lumen.so' });
    expect(leads[0].externalId).toContain('product_hunt-lumen');
  });

  // Regression: a Fetch non-200 must SURFACE as a thrown DirectoryScrapeError,
  // not be silently swallowed into 0 leads.
  it('throws DirectoryScrapeError on a Fetch non-200 (never swallows into 0 leads)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(fetchPageResponse('', { ok: false, status: 401 }));
    await expect(fetchDirectoryLeads('product_hunt')).rejects.toBeInstanceOf(DirectoryScrapeError);
  });

  // A rendered page with no extractable text is a failure, not empty success.
  it('throws when Fetch returns no page text', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(fetchPageResponse(''));
    await expect(fetchDirectoryLeads('product_hunt')).rejects.toBeInstanceOf(DirectoryScrapeError);
  });

  // Extraction that finds zero companies must throw so the source surfaces as failed.
  it('throws when extraction finds no companies', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(fetchPageResponse('a page with no companies on it'));
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify({ companies: [] }));
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

describe('Phase: YC detail-page founder enrichment', () => {
  afterEach(() => vi.restoreAllMocks());

  function detailPage(founders: unknown): Response {
    // YC embeds company props as entity-encoded JSON in the data-page attribute.
    const json = JSON.stringify({ props: { company: { founders } } });
    const encoded = json.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return { ok: true, status: 200, text: async () => `<div data-page="${encoded}"></div>` } as Response;
  }

  it('parses founders (name/role/linkedin/x) from the data-page JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      detailPage([
        { full_name: 'Brian Chesky', title: 'Founder/CEO', linkedin_url: 'https://www.linkedin.com/in/brianchesky/', twitter_url: 'https://x.com/bchesky' },
        { full_name: 'Nathan B', title: 'Founder/CTO', linkedin_url: 'https://www.linkedin.com/in/blecharczyk/' },
      ]),
    );
    const founders = await fetchYcFounders('airbnb');
    expect(founders).toHaveLength(2);
    expect(founders[0]).toEqual({
      name: 'Brian Chesky',
      role: 'Founder/CEO',
      linkedinUrl: 'https://www.linkedin.com/in/brianchesky/',
      xHandle: 'bchesky',
    });
  });

  it('returns [] gracefully when the page has no data-page blob', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => '<html>nope</html>' } as Response);
    expect(await fetchYcFounders('whatever')).toEqual([]);
  });

  it('fetchYcCompanyDetail maps company facts + founders for the card', async () => {
    // Real YC DETAIL-page field names (differ from the Algolia index).
    const company = {
      name: 'Acme',
      one_liner: 'We do X',
      long_description: 'We&#x27;re a team building &amp; testing.',
      website: 'https://acme.com',
      small_logo_url: 'https://logo/acme.png',
      batch_name: 'Winter 2025',
      team_size: 7,
      location: 'San Francisco',
      city: 'San Francisco',
      country: 'US',
      year_founded: 2025,
      ycdc_status: 'Active',
      tags: ['AI', 'Fintech'],
      company_photos: [{ id: 1, url: 'https://photo/1.png' }, { id: 2, url: 'https://photo/2.png' }],
      primary_group_partner: { full_name: 'Ankit Gupta', url: 'https://www.ycombinator.com/people/ankit-gupta' },
      linkedin_url: 'https://www.linkedin.com/company/acme',
      twitter_url: 'https://twitter.com/acme',
      founders: [{ full_name: 'Jane Doe', title: 'CEO', linkedin_url: 'https://li/jane', twitter_url: 'https://x.com/jane' }],
    };
    const encoded = JSON.stringify({ props: { company } }).replace(/"/g, '&quot;');
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => `<div data-page="${encoded}"></div>` } as Response);

    const detail = await fetchYcCompanyDetail('acme');
    expect(detail).toMatchObject({
      name: 'Acme',
      slug: 'acme',
      oneLiner: 'We do X',
      description: "We're a team building & testing.",
      website: 'https://acme.com',
      logoUrl: 'https://logo/acme.png',
      batch: 'Winter 2025',
      teamSize: 7,
      location: 'San Francisco',
      yearFounded: 2025,
      status: 'Active',
      industries: ['AI', 'Fintech'],
      photos: ['https://photo/1.png', 'https://photo/2.png'],
      primaryPartner: { name: 'Ankit Gupta', url: 'https://www.ycombinator.com/people/ankit-gupta' },
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      twitterUrl: 'https://twitter.com/acme',
      ycUrl: 'https://www.ycombinator.com/companies/acme',
    });
    expect(detail?.founders[0]).toMatchObject({ name: 'Jane Doe', linkedinUrl: 'https://li/jane', xHandle: 'jane' });
  });

  it('fetchYcCompanyDetail returns null when the page has no data-page blob', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => '<html>nope</html>' } as Response);
    expect(await fetchYcCompanyDetail('x')).toBeNull();
  });
});
