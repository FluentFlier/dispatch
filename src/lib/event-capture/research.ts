import { lookup } from 'dns/promises';
import { isIP } from 'node:net';

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
export async function serperSearch(query: string): Promise<SerperResult[]> {
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
      body: JSON.stringify({ q: query, num: 5 }),
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

  // Fetch and clean content from top 2 results only (cost/latency cap).
  const topUrls = results.slice(0, 2).map((r) => r.link);
  const textChunks: string[] = [];
  const usedSources: string[] = [];

  for (const url of topUrls) {
    try {
      const content = await jinaRead(url);
      if (content) {
        textChunks.push(content);
        usedSources.push(url);
      }
    } catch {
      // SSRF or fetch failure — skip this URL, continue.
    }
  }

  if (textChunks.length === 0) return null;

  // Combine chunks and truncate to 2000 tokens (spec: ~8000 chars).
  let rawText = textChunks.join('\n\n---\n\n');
  const MAX_TOKENS = 2000;
  const MAX_CHARS = MAX_TOKENS * 4;

  if (approximateTokens(rawText) > MAX_TOKENS) {
    rawText = rawText.slice(0, MAX_CHARS);
  }

  // Extract lightweight structured data from text using simple heuristics.
  // Full NLP extraction is handled by the Haiku question-generation prompt in Stage 2.
  const summary = results[0]?.snippet ?? title;
  const key_topics: string[] = [];
  const key_announcements: string[] = [];
  const speakers: Array<{ name: string; title?: string; handle?: string }> = [];

  // Extract speaker names from common patterns: "Name, Title at Company" or "@handle"
  const speakerPattern = /(?:speaker|presenter|host|keynote)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = speakerPattern.exec(rawText)) !== null) {
    if (speakers.length < 5) {
      speakers.push({ name: match[1] });
    }
  }

  return {
    summary,
    speakers,
    key_topics,
    key_announcements,
    sources: usedSources,
    raw_text: rawText,
  };
}
