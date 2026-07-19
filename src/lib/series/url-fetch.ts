/**
 * Fetches + extracts readable text from a URL via Apify's rag-web-browser actor
 * (the same scraping stack signals uses). Returns clean text for chunking.
 *
 * Gated on APIFY_TOKEN: without it the actor can't run, so we return a typed
 * failure the ingest route surfaces as a 'failed' source rather than throwing.
 * SPA-heavy pages may extract poorly - that's a known ceiling of any HTML reader.
 */
const MAX_URL_CHARS = 20000;

export async function fetchUrlText(
  url: string,
): Promise<{ ok: true; text: string; title?: string } | { ok: false; error: string }> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    return { ok: false, error: 'URL fetch unavailable (APIFY_TOKEN not set).' };
  }
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~rag-web-browser/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=45`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: url, maxResults: 1, outputFormats: ['markdown'] }),
        signal: AbortSignal.timeout(50_000),
      },
    );
    if (!res.ok) return { ok: false, error: `URL fetch failed (HTTP ${res.status}).` };

    const items = (await res.json()) as Array<{
      markdown?: string;
      text?: string;
      metadata?: { title?: string };
    }>;
    const first = items[0];
    const text = (first?.markdown ?? first?.text ?? '').trim();
    if (!text) return { ok: false, error: 'No readable text extracted from URL.' };
    return { ok: true, text: text.slice(0, MAX_URL_CHARS), title: first?.metadata?.title };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'URL fetch error';
    return { ok: false, error: msg };
  }
}
