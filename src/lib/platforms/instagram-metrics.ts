import type { NormalizedMetrics } from './twitter-metrics';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** A single row from the IG media `insights` edge. */
export interface IgInsightValue {
  name: string;
  values?: { value: number }[];
}

/** Top-level fields from a GET on the media node. */
export interface IgMediaFields {
  like_count?: number;
  comments_count?: number;
}

/**
 * Map Instagram insights + media fields onto our normalized metrics.
 * WHY: IG splits data across two shapes — engagement counts live on the media
 * node (like_count, comments_count) while reach/impressions/saved come from the
 * insights edge. `saved` maps to our "saves"; we prefer insights `impressions`
 * for "views" and fall back to `reach` when impressions are absent.
 */
export function mapInstagramInsights(
  insights: IgInsightValue[] | undefined,
  media: IgMediaFields | undefined,
): NormalizedMetrics {
  const out: NormalizedMetrics = {};
  const byName = new Map<string, number>();
  for (const row of insights ?? []) {
    const v = row.values?.[0]?.value;
    if (typeof v === 'number') byName.set(row.name, v);
  }

  const impressions = byName.get('impressions');
  const reach = byName.get('reach');
  if (typeof impressions === 'number') out.views = impressions;
  else if (typeof reach === 'number') out.views = reach;

  const saved = byName.get('saved');
  if (typeof saved === 'number') out.saves = saved;

  if (typeof media?.like_count === 'number') out.likes = media.like_count;
  if (typeof media?.comments_count === 'number') out.comments = media.comments_count;

  return out;
}

/**
 * Fetch live metrics for one Instagram media object via the Graph API.
 * Requires a Business/Creator account token. Returns {} (never throws) on any
 * failure so a single media error does not abort a batch sync.
 */
export async function fetchInstagramMetrics(
  accessToken: string,
  mediaId: string,
): Promise<NormalizedMetrics> {
  try {
    const [insightsRes, mediaRes] = await Promise.all([
      fetch(`${GRAPH_BASE}/${mediaId}/insights?metric=impressions,reach,saved&access_token=${encodeURIComponent(accessToken)}`),
      fetch(`${GRAPH_BASE}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(accessToken)}`),
    ]);

    const insights = insightsRes.ok
      ? ((await insightsRes.json()).data as IgInsightValue[] | undefined)
      : undefined;
    const media = mediaRes.ok
      ? ((await mediaRes.json()) as IgMediaFields)
      : undefined;

    return mapInstagramInsights(insights, media);
  } catch {
    return {};
  }
}
