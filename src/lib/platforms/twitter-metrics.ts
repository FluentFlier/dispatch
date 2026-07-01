import { TwitterApi } from 'twitter-api-v2';

/**
 * Normalized post metrics shared across platforms. Fields are optional because
 * not every platform (or API tier) exposes every metric — callers must only
 * overwrite stored values that actually came back.
 */
export interface NormalizedMetrics {
  views?: number;
  likes?: number;
  saves?: number;
  comments?: number;
  shares?: number;
}

/** Shape of X API v2 `public_metrics` (all optional across access tiers). */
export interface TweetPublicMetrics {
  impression_count?: number;
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  bookmark_count?: number;
}

/**
 * Map X `public_metrics` onto our normalized shape.
 * WHY explicit mapping: X terminology differs from ours — impressions are our
 * "views", bookmarks are the closest analogue to "saves", and shares combine
 * retweets + quotes. impression_count and bookmark_count are only returned for
 * the tweet owner and on higher API tiers, so they stay undefined when absent
 * (we never zero-out a metric we couldn't read).
 */
export function mapTweetPublicMetrics(pm: TweetPublicMetrics | undefined): NormalizedMetrics {
  if (!pm) return {};
  const out: NormalizedMetrics = {};
  if (typeof pm.impression_count === 'number') out.views = pm.impression_count;
  if (typeof pm.like_count === 'number') out.likes = pm.like_count;
  if (typeof pm.bookmark_count === 'number') out.saves = pm.bookmark_count;
  if (typeof pm.reply_count === 'number') out.comments = pm.reply_count;
  if (typeof pm.retweet_count === 'number' || typeof pm.quote_count === 'number') {
    out.shares = (pm.retweet_count ?? 0) + (pm.quote_count ?? 0);
  }
  return out;
}

/**
 * Fetch live metrics for a single tweet using an OAuth2 user-context token.
 * Returns an empty object (never throws) on API failure so one bad tweet does
 * not abort a batch sync — the caller logs and continues.
 */
export async function fetchTweetMetrics(
  accessToken: string,
  tweetId: string,
): Promise<NormalizedMetrics> {
  try {
    const client = new TwitterApi(accessToken);
    const res = await client.v2.singleTweet(tweetId, { 'tweet.fields': ['public_metrics'] });
    return mapTweetPublicMetrics(res.data?.public_metrics as TweetPublicMetrics | undefined);
  } catch {
    return {};
  }
}
