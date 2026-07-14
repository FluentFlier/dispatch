import { signalsDebugEnabled, scrapeTimeoutMs } from '@/lib/signals/ingest/config';

/**
 * TinyFish Search + Fetch: the FAST web-infra surfaces, used in place of the slow
 * Agent (browser-automation) surface for search and page reads.
 *
 * - Search (GET api.search.tinyfish.ai?query=): ranked, structured JSON results in
 *   ~500ms - no CAPTCHA, no visual scrape. Replaces "Agent reads google.com" +
 *   Serper.
 * - Fetch (POST api.fetch.tinyfish.ai {urls}): renders each URL in a real Chromium
 *   (JS/SPA aware), strips nav/ads, returns clean text. ~1-2s even for heavy SPAs
 *   (Product Hunt, YC Launches) that made the Agent time out at 200s+. Replaces the
 *   Agent directory scrape + Jina reader.
 *
 * Both authenticate with the same TINYFISH_API_KEY and are free on every plan
 * (30 searches/min, 150 fetches/min). See docs.tinyfish.ai.
 */
const SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai';
const FETCH_ENDPOINT = 'https://api.fetch.tinyfish.ai';

/** True when the TinyFish key is present (shared by Agent/Search/Fetch). */
export function isTinyfishConfigured(): boolean {
  return Boolean(process.env.TINYFISH_API_KEY?.trim());
}

export interface TinyfishSearchResult {
  title?: string;
  url: string;
  snippet?: string;
  siteName?: string;
}

/** Raw shapes returned by the endpoints (only the fields we consume). */
interface RawSearchResponse {
  results?: Array<{ title?: string; url?: string; link?: string; snippet?: string; site_name?: string }>;
}
interface RawFetchResponse {
  results?: Array<{
    url?: string;
    final_url?: string;
    title?: string;
    description?: string;
    text?: string;
    markdown?: string;
    content?: string;
  }>;
}

export interface TinyfishFetchResult {
  url: string;
  title?: string;
  /** Clean rendered page text (markdown-ish), nav/ads stripped. */
  text: string;
}

/** Bounds a request so a slow/hung call fails fast instead of stalling the run. */
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), scrapeTimeoutMs());
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ranked web search via TinyFish Search. Returns up to `num` structured results.
 * Throws on a non-2xx so the caller can decide to fall back; returns [] only when
 * the key is missing or the response carries no results.
 */
export async function tinyfishSearch(query: string, num = 10): Promise<TinyfishSearchResult[]> {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key || !query.trim()) return [];

  const url = `${SEARCH_ENDPOINT}?query=${encodeURIComponent(query.trim())}`;
  const res = await timedFetch(url, { headers: { 'X-API-Key': key } });
  if (!res.ok) throw new Error(`TinyFish Search ${res.status}: ${await res.text()}`);

  const payload = (await res.json()) as RawSearchResponse;
  const rows = (payload.results ?? [])
    .map((r) => ({
      title: r.title,
      url: (r.url ?? r.link ?? '').trim(),
      snippet: r.snippet,
      siteName: r.site_name,
    }))
    .filter((r) => r.url)
    .slice(0, num);

  if (signalsDebugEnabled()) {
    console.log(`[tinyfish-search] query="${query}" -> ${rows.length} results`);
  }
  return rows;
}

/**
 * Renders one or more URLs via TinyFish Fetch and returns their clean text. A URL
 * that yields no text is dropped. Throws on a non-2xx so the caller isolates the
 * failure. Batched (the endpoint accepts many URLs per call, 150/min free).
 */
export async function tinyfishFetch(urls: string[]): Promise<TinyfishFetchResult[]> {
  const key = process.env.TINYFISH_API_KEY?.trim();
  const clean = urls.map((u) => u.trim()).filter(Boolean);
  if (!key || clean.length === 0) return [];

  const res = await timedFetch(FETCH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify({ urls: clean }),
  });
  if (!res.ok) throw new Error(`TinyFish Fetch ${res.status}: ${await res.text()}`);

  const payload = (await res.json()) as RawFetchResponse;
  const rows = (payload.results ?? [])
    .map((r) => ({
      url: (r.final_url ?? r.url ?? '').trim(),
      title: r.title,
      text: (r.text ?? r.markdown ?? r.content ?? '').trim(),
    }))
    .filter((r) => r.url && r.text);

  if (signalsDebugEnabled()) {
    console.log(`[tinyfish-fetch] ${clean.length} urls -> ${rows.length} pages with text`);
  }
  return rows;
}
