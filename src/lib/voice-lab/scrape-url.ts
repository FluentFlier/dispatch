import { createApifyClient } from '@/lib/signals/ingest/apify-fetch';

/**
 * Voice-import URL scraping, routed by link type.
 *
 * Public-link voice import used to send EVERY url through r.jina.ai (see the
 * import route). That returns LinkedIn's "Agree & Join / Sign in" login wall for
 * any linkedin.com/in/ profile — which passed the >=80-char check and became a
 * bogus "voice sample." LinkedIn actively gates guest access, so an unauthenticated
 * reader can never read a profile's posts.
 *
 * So we branch on the url:
 *   - LinkedIn profile/company → Apify linkedin-posts-scraper (real posts),
 *     falling back to the TinyFish agent (which drives a real browser).
 *   - Any other LinkedIn url (a single post/feed permalink) → TinyFish only,
 *     since the profile scraper takes profile urls.
 *   - Everything else → handled by the caller's reader path; TinyFish is the
 *     shared last-resort fallback there too.
 *
 * Each scraper THROWS when its provider key is unset or the run fails, so the
 * orchestrator can fall through to the next tier and the route records a per-url
 * failure instead of a silent empty import.
 */

const TINYFISH_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';
const TINYFISH_TIMEOUT_MS = 120_000;
const MAX_SAMPLES = 20;

export type UrlKind = 'linkedin-profile' | 'linkedin-other' | 'web';

/** Classifies a url so the caller picks the right scraper. */
export function classifyUrl(url: string): UrlKind {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    return 'web';
  }
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return 'web';
  if (path.startsWith('/in/') || path.startsWith('/company/') || path.startsWith('/school/')) {
    return 'linkedin-profile';
  }
  return 'linkedin-other';
}

/** Pulls the post text out of an Apify linkedin-posts-scraper item, tolerant of field naming. */
function apifyItemText(item: Record<string, unknown>): string {
  const raw =
    item.text ??
    item.postText ??
    item.content ??
    item.commentary ??
    item.description ??
    item.title ??
    '';
  return String(raw).trim();
}

/**
 * Scrapes a public LinkedIn profile's recent posts via Apify. Returns each post
 * as its own voice sample (no chunking — one post is one authentic voice unit).
 * Throws when APIFY_TOKEN is unset or the actor returns nothing usable.
 */
export async function scrapeLinkedInViaApify(url: string, maxPosts = MAX_SAMPLES): Promise<string[]> {
  const apify = createApifyClient();
  if (!apify) throw new Error('Apify not configured');

  const run = await apify.actor('apify/linkedin-posts-scraper').call({
    profileUrls: [url],
    maxPosts,
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();

  const samples = (items ?? [])
    .map((it) => apifyItemText(it as Record<string, unknown>))
    .filter((text) => text.length >= 40)
    .slice(0, maxPosts);

  if (samples.length === 0) throw new Error('Apify returned no readable posts');
  return samples;
}

interface TinyFishResponse {
  status?: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

/**
 * Scrapes any public url via the TinyFish browser agent, asking it to extract the
 * author's own written posts/articles. Used as the fallback for LinkedIn (when
 * Apify is unavailable or empty) and for any non-LinkedIn url the reader can't
 * read. Throws when TINYFISH_API_KEY is unset or the run fails.
 */
export async function scrapeViaTinyFish(url: string, maxSamples = MAX_SAMPLES): Promise<string[]> {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key) throw new Error('TinyFish not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TINYFISH_TIMEOUT_MS);
  try {
    const res = await fetch(TINYFISH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({
        url,
        goal:
          'Extract the main written content authored by the person or account on this page: ' +
          'their posts, articles, or updates. Return the full text of each item verbatim, ' +
          'skipping navigation, ads, comments from other people, and login prompts.',
        output_schema: {
          type: 'object',
          properties: {
            posts: {
              type: 'array',
              items: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          },
          required: ['posts'],
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TinyFish ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const payload = (await res.json()) as TinyFishResponse;
    if (payload.status !== 'COMPLETED' || payload.error) {
      throw new Error(`TinyFish run ${payload.status ?? 'unknown'}: ${payload.error ?? 'no result'}`);
    }

    const rows = payload.result?.posts;
    const samples = (Array.isArray(rows) ? rows : [])
      .map((r) => String((r as Record<string, unknown>)?.text ?? '').trim())
      .filter((text) => text.length >= 40)
      .slice(0, maxSamples);

    if (samples.length === 0) throw new Error('TinyFish returned no readable content');
    return samples;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scrapes a LinkedIn url into voice samples: Apify for profiles (with a TinyFish
 * fallback), TinyFish for single-post permalinks. Throws when every configured
 * tier fails so the caller records the url as a failure.
 */
export async function scrapeLinkedIn(url: string): Promise<string[]> {
  const kind = classifyUrl(url);
  const errors: string[] = [];

  if (kind === 'linkedin-profile') {
    try {
      return await scrapeLinkedInViaApify(url);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    return await scrapeViaTinyFish(url);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  throw new Error(
    `Could not read LinkedIn url (a public scraper is required — connect Apify or TinyFish): ${errors.join('; ')}`,
  );
}
