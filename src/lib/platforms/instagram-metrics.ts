import type { NormalizedMetrics } from './twitter-metrics';

// Instagram (Facebook Login flavor, matching our publish client which uses
// graph.facebook.com). v23.0+ is required for the `views` metric that replaced
// the now-deprecated `impressions` (impressions errors on media created on/after
// 2024-07-02 when called after 2025-04-21). See Meta Graph API v22 changelog.
const GRAPH_BASE = 'https://graph.facebook.com/v23.0';

// Insights metrics we request. `views` is the current universal reach metric
// (replaces impressions/plays/video_views); `saved` = unique saves. Likes and
// comments come from the media node fields instead (more reliable across types).
const INSIGHT_METRICS = 'views,reach,saved';

/** A single row from the IG media `insights` edge. */
export interface IgInsightRow {
  name: string;
  /** Newer `total_value`-typed metrics return the figure here... */
  total_value?: { value: number };
  /** ...older metrics return it in values[0].value. */
  values?: { value: number }[];
}

/** Top-level fields from a GET on the media node. */
export interface IgMediaFields {
  like_count?: number;
  comments_count?: number;
}

/**
 * Read a metric value tolerating both shapes: newer `total_value` metrics
 * (e.g. `views`) put the number in `total_value.value`, while legacy metrics
 * use `values[0].value`. Meta mixes these, so we check both.
 */
function readInsight(row: IgInsightRow | undefined): number | undefined {
  if (!row) return undefined;
  if (typeof row.total_value?.value === 'number') return row.total_value.value;
  if (typeof row.values?.[0]?.value === 'number') return row.values[0].value;
  return undefined;
}

/**
 * Map Instagram insights + media fields onto our normalized metrics.
 * WHY: IG splits data across two calls - engagement counts live on the media
 * node (like_count, comments_count) while views/reach/saved come from the
 * insights edge. `saved` maps to our "saves"; we prefer `views` for our "views"
 * figure and fall back to `reach` when views is absent.
 * Deprecated names (`impressions`, `plays`, `video_views`) are never requested.
 */
export function mapInstagramInsights(
  insights: IgInsightRow[] | undefined,
  media: IgMediaFields | undefined,
): NormalizedMetrics {
  const out: NormalizedMetrics = {};
  const byName = new Map<string, IgInsightRow>();
  for (const row of insights ?? []) byName.set(row.name, row);

  const views = readInsight(byName.get('views'));
  const reach = readInsight(byName.get('reach'));
  if (typeof views === 'number') out.views = views;
  else if (typeof reach === 'number') out.views = reach;

  const saved = readInsight(byName.get('saved'));
  if (typeof saved === 'number') out.saves = saved;

  if (typeof media?.like_count === 'number') out.likes = media.like_count;
  if (typeof media?.comments_count === 'number') out.comments = media.comments_count;

  return out;
}

/**
 * Fetch live metrics for one Instagram media object via the Graph API.
 * Requires a Business/Creator account token that owns the media. Returns {}
 * (never throws) on any failure so a single media error does not abort a batch
 * sync - the caller logs and continues.
 */
export async function fetchInstagramMetrics(
  accessToken: string,
  mediaId: string,
): Promise<NormalizedMetrics> {
  try {
    const [insightsRes, mediaRes] = await Promise.all([
      fetch(`${GRAPH_BASE}/${mediaId}/insights?metric=${INSIGHT_METRICS}&access_token=${encodeURIComponent(accessToken)}`),
      fetch(`${GRAPH_BASE}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(accessToken)}`),
    ]);

    const insights = insightsRes.ok
      ? ((await insightsRes.json()).data as IgInsightRow[] | undefined)
      : undefined;
    const media = mediaRes.ok
      ? ((await mediaRes.json()) as IgMediaFields)
      : undefined;

    return mapInstagramInsights(insights, media);
  } catch {
    return {};
  }
}
