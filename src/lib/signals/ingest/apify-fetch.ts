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
