import { ApifyClient } from 'apify-client';
import { apifyItemToPost } from '@/lib/signals/ingest/normalize';
import type { IngestedPost, SignalPlatform, SignalSourceRow } from '@/lib/signals/types';

function normalizeHandle(handleOrUrl: string, platform: SignalPlatform): string {
  if (handleOrUrl.startsWith('http')) return handleOrUrl;
  return handleOrUrl.replace(/^@/, '');
}

function linkedInPollUrl(target: string, sourceType: SignalSourceRow['source_type']): string {
  if (target.startsWith('http')) return target;
  if (sourceType === 'company_page') {
    return `https://linkedin.com/company/${target.replace(/^@/, '')}`;
  }
  return `https://linkedin.com/in/${target.replace(/^@/, '')}`;
}

/**
 * Builds an X search query from a monitored keyword. Hashtags and inputs that
 * already use advanced X operators pass through raw; plain multi-word inputs
 * are quoted for exact-phrase matching. Retweets are always excluded - a
 * retweet's author is not the lead.
 */
export function buildSearchQuery(handleOrUrl: string): string {
  const input = handleOrUrl.trim();
  const hasOperators = /(?:^|\s)(?:filter:|from:|to:|since:|until:|OR\s)/.test(input);
  if (hasOperators) return input;

  const core =
    input.startsWith('#') || !/\s/.test(input) ? input : `"${input.replace(/"/g, '')}"`;
  return `${core} -filter:retweets`;
}

/**
 * Fetches recent X posts matching a keyword-search source. Uses the same
 * apify/twitter-scraper actor as profile polls, pointed at the "Latest" search
 * tab (which keeps results roughly reverse-chronological, so the time-window
 * cursor is sound). `searchTerms` is passed alongside the search startUrl for
 * actor variants that prefer it - whichever the actor honors wins.
 */
export async function fetchKeywordPostsViaApify(
  source: SignalSourceRow,
  apify: ApifyClient,
  maxItems: number,
): Promise<IngestedPost[]> {
  const query = buildSearchQuery(source.handle_or_url);
  const run = await apify.actor('apify/twitter-scraper').call({
    startUrls: [
      { url: `https://x.com/search?q=${encodeURIComponent(query)}&f=live&src=typed_query` },
    ],
    searchTerms: [query],
    sort: 'Latest',
    maxItems,
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();

  const posts: IngestedPost[] = [];
  for (const it of items ?? []) {
    // Empty fallback handle: for search results (unlike profile polls) there is
    // no tracked handle to fall back to, and an authorless post is a useless
    // lead - apifyItemToPost's empty-handle output is dropped below.
    const post = apifyItemToPost(it as Record<string, unknown>, 'x', '');
    if (post && post.authorHandle) posts.push(post);
  }
  return posts;
}

export async function fetchPostsViaApify(
  source: SignalSourceRow,
  apify: ApifyClient,
  maxItems: number,
): Promise<IngestedPost[]> {
  const target = normalizeHandle(source.handle_or_url, source.platform);
  const posts: IngestedPost[] = [];

  if (source.platform === 'x') {
    const run = await apify.actor('apify/twitter-scraper').call({
      startUrls: [{ url: target.startsWith('http') ? target : `https://x.com/${target}` }],
      maxItems,
    });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    for (const it of items ?? []) {
      const post = apifyItemToPost(it as Record<string, unknown>, 'x', target);
      if (post) posts.push(post);
    }
    return posts;
  }

  const url = linkedInPollUrl(target, source.source_type);
  const run = await apify.actor('apify/linkedin-posts-scraper').call({
    profileUrls: [url],
    maxPosts: maxItems,
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  for (const it of items ?? []) {
    const post = apifyItemToPost(it as Record<string, unknown>, 'linkedin', target);
    if (post) posts.push(post);
  }
  return posts;
}

export function createApifyClient(): ApifyClient | null {
  const token = process.env.APIFY_TOKEN;
  return token ? new ApifyClient({ token }) : null;
}
