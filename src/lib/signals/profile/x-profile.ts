import { createApifyClient } from '@/lib/signals/ingest/apify-fetch';

export interface XProfileState {
  handle: string;
  name?: string;
  bio?: string;
}

/**
 * Fetches a single X (Twitter) user profile via Apify, for bio-change
 * watchlist tracking (mirrors the LinkedIn profile-resolve helpers in
 * unipile-linkedin.ts). Actor is configurable via X_PROFILE_APIFY_ACTOR
 * (default apidojo/twitter-user-scraper). Returns null when APIFY_TOKEN is
 * unset (reuses createApifyClient's gate) or the actor returns no data -
 * callers treat null as "skip, don't invent a profile".
 */
export async function fetchXProfile(handle: string): Promise<XProfileState | null> {
  const apify = createApifyClient();
  if (!apify) return null;

  const actorId = process.env.X_PROFILE_APIFY_ACTOR || 'apidojo/twitter-user-scraper';
  const target = handle.replace(/^@/, '');

  const run = await apify.actor(actorId).call({ twitterHandles: [target] }, { waitSecs: 30 });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  const item = items?.[0] as Record<string, unknown> | undefined;
  if (!item) return null;

  return {
    handle: target,
    name: item.name ? String(item.name) : undefined,
    bio: item.bio ? String(item.bio) : undefined,
  };
}
