const BASE_URL = process.env.THEHOG_BASE_URL?.trim() || 'https://developer.thehog.ai';

export function isTheHogConfigured(): boolean {
  return Boolean(process.env.THEHOG_ACCESS_KEY?.trim() && process.env.THEHOG_SECRET_KEY?.trim());
}

export interface TheHogLinkedInPost {
  id: string;
  text: string;
  url?: string;
}

interface HogScraperResponse {
  data?: { posts?: Array<{ id?: string; text?: string; url?: string; content?: string }> };
  posts?: Array<{ id?: string; text?: string; url?: string; content?: string }>;
}

/**
 * Fetches recent LinkedIn profile posts via The Hog scraper (optional fallback).
 */
export async function fetchTheHogLinkedInPosts(
  profileUrl: string,
  limit = 5,
): Promise<TheHogLinkedInPost[]> {
  if (!isTheHogConfigured()) return [];

  const res = await fetch(`${BASE_URL}/api/v1/platform/scrapers/linkedin/profile-posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key': process.env.THEHOG_ACCESS_KEY!.trim(),
      'X-Secret-Key': process.env.THEHOG_SECRET_KEY!.trim(),
    },
    body: JSON.stringify({ profile_url: profileUrl, limit }),
  });

  if (!res.ok) return [];

  const json = (await res.json()) as HogScraperResponse;
  const rows = json.data?.posts ?? json.posts ?? [];
  const out: TheHogLinkedInPost[] = [];

  for (const row of rows) {
    const text = (row.text ?? row.content ?? '').trim();
    if (text.length < 25 || !row.id) continue;
    out.push({
      id: row.id,
      text: text.slice(0, 2000),
      url: row.url,
    });
    if (out.length >= limit) break;
  }

  return out;
}
