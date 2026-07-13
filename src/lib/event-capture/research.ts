import { lookup } from 'dns/promises';
import { isIP } from 'node:net';
import type { createClient } from '@insforge/sdk';
import { extractResearchFacts } from '@/lib/event-capture/extract';

type InsforgeClient = ReturnType<typeof createClient>;

// --- Constants ---

/** Max event pages to read per event (cost/latency cap). */
const MAX_READ_URLS = 2;
/** Truncate combined page text to ~2000 tokens (≈8000 chars) before storage/LLM. */
const MAX_TOKENS = 2000;
/** Cache entries older than this are treated as stale and re-researched. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// --- SSRF guard ---

/**
 * Checks whether an IPv4 or IPv6 address falls within a private or loopback range.
 * Used by assertPublicUrl to block SSRF attacks that redirect to internal services.
 */
function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 0) return true;
    return false;
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('::ffff:127.')) return true;
  }

  return false;
}

/**
 * Validates that a URL is safe to fetch — public host, http(s) only, no private IPs.
 * Must be called before EVERY external HTTP request in research flows.
 * Resolves the hostname via DNS and rejects if any resolved address is private.
 * Throws on any violation so the caller can catch and skip without crashing the cron.
 */
export async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http and https protocols are allowed (got ${parsed.protocol})`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject hostname-based private references before DNS lookup.
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '0.0.0.0'
  ) {
    throw new Error('Private hosts are not allowed');
  }

  // If the hostname is already a raw IP, check it directly.
  if (isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) throw new Error('Private IP addresses are not allowed');
    return parsed;
  }

  // DNS resolution — check all A/AAAA records to prevent DNS rebinding attacks.
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error('URL resolves to a private IP address — blocked for SSRF protection');
  }

  return parsed;
}

// --- Serper search ---

interface SerperResult {
  link: string;
  title?: string;
  snippet?: string;
}

interface SerperResponse {
  organic?: SerperResult[];
}

/**
 * Searches the public web for an event using the Serper API.
 * Returns up to 5 organic result URLs for subsequent Jina reader fetching.
 * Falls back gracefully: if Serper returns no results or the API key is missing,
 * returns an empty array so the enrich cron continues with generic questions.
 */
export async function serperSearch(query: string, num = 5): Promise<SerperResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[research] SERPER_API_KEY not configured — skipping web search');
    return [];
  }

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num }),
    });

    if (!res.ok) {
      console.warn('[research] Serper search failed', { status: res.status, query });
      return [];
    }

    const data = (await res.json()) as SerperResponse;
    return data.organic ?? [];
  } catch (err) {
    console.warn('[research] Serper search error', { err, query });
    return [];
  }
}

// --- Jina reader ---

/**
 * Fetches the readable text content of a URL using the Jina AI reader API (r.jina.ai).
 * Must be preceded by assertPublicUrl to prevent SSRF.
 * Returns the plain-text body, or null if the fetch fails or produces no usable content.
 */
export async function jinaRead(url: string): Promise<string | null> {
  try {
    await assertPublicUrl(url);

    const readerUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(readerUrl, {
      headers: { Accept: 'text/plain' },
    });

    if (!res.ok) {
      console.warn('[research] Jina read failed', { status: res.status, url });
      return null;
    }

    const text = await res.text();
    // Strip Jina metadata headers from the top of the response.
    const cleaned = text
      .replace(/^(Title|URL Source|Markdown Content|Published Time):[^\n]*\n/gim, '')
      .replace(/^Warning:[^\n]*\n/gim, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/[#*_>`]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return cleaned.length >= 80 ? cleaned : null;
  } catch (err) {
    console.warn('[research] Jina read error', { err, url });
    return null;
  }
}

// --- Research result type ---

export interface EventResearch {
  summary: string;
  speakers: Array<{ name: string; title?: string; handle?: string }>;
  key_topics: string[];
  key_announcements: string[];
  sources: string[];
  raw_text: string;
}

// --- Approximate token count (1 token ≈ 4 chars for English text) ---
function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Orchestrates web research for a public event: Serper search → Jina read → structured extraction.
 * Limited to top 2 URLs to keep cron latency predictable.
 * Truncates raw_text to 2000 tokens before returning (spec requirement for Claude call safety).
 * Returns null if no useful content is found — caller generates generic questions instead.
 */
export async function researchPublicEvent(
  title: string,
  location: string | null,
  startDate: Date,
): Promise<EventResearch | null> {
  const year = startDate.getFullYear();
  const month = startDate.toLocaleString('en-US', { month: 'long' });

  // Primary query: specific title + location + year for precision.
  const primaryQuery = location
    ? `"${title}" ${location} ${year}`
    : `"${title}" ${month} ${year}`;

  // Fallback query: title + month for events with no location or when primary fails.
  const fallbackQuery = `"${title}" ${month} ${year}`;

  let results = await serperSearch(primaryQuery);
  if (results.length === 0 && primaryQuery !== fallbackQuery) {
    results = await serperSearch(fallbackQuery);
  }

  if (results.length === 0) return null;

  // Read the top results in parallel (jinaRead never throws — it returns null on
  // any failure, including SSRF rejection). Preserve URL order for source attribution.
  const topUrls = results.slice(0, MAX_READ_URLS).map((r) => r.link);
  const reads = await Promise.allSettled(topUrls.map((url) => jinaRead(url)));

  const textChunks: string[] = [];
  const usedSources: string[] = [];
  reads.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      textChunks.push(result.value);
      usedSources.push(topUrls[i]);
    }
  });

  if (textChunks.length === 0) return null;

  // Combine chunks and truncate to MAX_TOKENS (~8000 chars) before storage/extraction.
  let rawText = textChunks.join('\n\n---\n\n');
  const MAX_CHARS = MAX_TOKENS * 4;
  if (approximateTokens(rawText) > MAX_TOKENS) {
    rawText = rawText.slice(0, MAX_CHARS);
  }

  // Extract structured facts via the configured LLM (premium in prod, free in
  // testing — see ai-tiers.ts). Degrades to the SERP snippet + empty structure
  // when extraction is unavailable, matching the pre-LLM fallback behavior.
  const facts = await extractResearchFacts(rawText, title);

  return {
    summary: facts?.summary || (results[0]?.snippet ?? title),
    speakers: facts?.speakers ?? [],
    key_topics: facts?.key_topics ?? [],
    key_announcements: facts?.key_announcements ?? [],
    sources: usedSources,
    raw_text: rawText,
  };
}

// --- Cross-workspace research cache ---

/**
 * Builds the normalized cache key for an event: lower(title) | date | lower(location).
 * Same public event across workspaces maps to one key, so research is paid for once.
 * Pure and deterministic — safe to unit test without a DB.
 */
export function researchCacheKey(
  title: string,
  location: string | null,
  startDate: Date,
): string {
  const day = startDate.toISOString().split('T')[0];
  const loc = (location ?? '').trim().toLowerCase();
  return `${title.trim().toLowerCase()}|${day}|${loc}`;
}

interface ResearchCacheRow {
  summary: string;
  speakers: EventResearch['speakers'];
  key_topics: string[];
  key_announcements: string[];
  sources: string[];
  raw_text: string;
  updated_at: string;
}

/**
 * Reads a fresh (< 30 day) cached research row by normalized key.
 * Returns null on miss, staleness, or any DB error (logged) so the caller falls
 * back to a live research run — the cache is an optimization, never load-bearing.
 */
export async function getCachedResearch(
  client: InsforgeClient,
  key: string,
): Promise<EventResearch | null> {
  try {
    const { data } = await client.database
      .from('event_research_cache')
      .select('summary, speakers, key_topics, key_announcements, sources, raw_text, updated_at')
      .eq('research_key', key)
      .maybeSingle();

    if (!data) return null;
    const row = data as ResearchCacheRow;

    if (Date.now() - new Date(row.updated_at).getTime() > CACHE_TTL_MS) return null;

    return {
      summary: row.summary,
      speakers: row.speakers ?? [],
      key_topics: row.key_topics ?? [],
      key_announcements: row.key_announcements ?? [],
      sources: row.sources ?? [],
      raw_text: row.raw_text,
    };
  } catch (err) {
    console.warn('[event-research] cache read failed', { key, err });
    return null;
  }
}

/**
 * Upserts a research result into the cross-workspace cache, refreshing updated_at.
 * Failures are logged and swallowed — a cache write failure must never break the
 * enrich job that produced valid research.
 */
export async function putCachedResearch(
  client: InsforgeClient,
  key: string,
  research: EventResearch,
): Promise<void> {
  try {
    await client.database.from('event_research_cache').upsert(
      {
        research_key: key,
        summary: research.summary,
        speakers: research.speakers,
        key_topics: research.key_topics,
        key_announcements: research.key_announcements,
        sources: research.sources,
        raw_text: research.raw_text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'research_key' },
    );
  } catch (err) {
    console.warn('[event-research] cache write failed', { key, err });
  }
}
