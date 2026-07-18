import type { Post } from '@/lib/types';
import type { Status } from '@/lib/constants';

/**
 * A part's production journey, deferring publishing to the very end. Creators
 * plan the arc, then script -> shoot -> edit -> write caption/hook/hashtags,
 * and only then schedule or publish.
 *
 * This is COMPUTED from a Post's existing fields, not a stored column. The
 * `posts.status` enum already tracks idea/scripted/filmed/edited/posted; the
 * remaining two stages are derived from `caption` presence and `scheduled_date`.
 * No migration, no second source of truth.
 */
export type SeriesStageId =
  | 'planned'
  | 'scripted'
  | 'filmed'
  | 'edited'
  | 'captioned'
  | 'scheduled'
  | 'posted';

export interface SeriesStage {
  id: SeriesStageId;
  label: string;
  /** The post.status this stage writes when clicked, or null if it is reached
   *  through a real action (write a caption, schedule, publish) instead. */
  status: Status | null;
  hint: string;
}

export const SERIES_STAGES: readonly SeriesStage[] = [
  { id: 'planned',   label: 'Planned',   status: 'idea',     hint: 'Part outlined, nothing produced yet' },
  { id: 'scripted',  label: 'Scripted',  status: 'scripted', hint: 'Script written' },
  { id: 'filmed',    label: 'Filmed',    status: 'filmed',   hint: 'Footage shot' },
  { id: 'edited',    label: 'Edited',    status: 'edited',   hint: 'Video cut and edited' },
  { id: 'captioned', label: 'Captioned', status: null,       hint: 'Caption, hook and hashtags written' },
  { id: 'scheduled', label: 'Scheduled', status: null,       hint: 'Placed on the calendar' },
  { id: 'posted',    label: 'Posted',    status: 'posted',   hint: 'Published' },
] as const;

export const LAST_STAGE_INDEX = SERIES_STAGES.length - 1;

function has(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

/**
 * Resolve the highest production stage a part has reached. Checked top-down so
 * a later stage always wins (a posted part is 'posted' even without a caption).
 */
export function resolveSeriesStage(post: Post): number {
  if (post.status === 'posted') return 6;
  if (has(post.scheduled_date)) return 5;
  if (has(post.caption)) return 4;
  if (post.status === 'edited') return 3;
  if (post.status === 'filmed') return 2;
  if (post.status === 'scripted' || has(post.script)) return 1;
  return 0;
}

/** A part is ready to publish once it has something to publish. */
export function isPublishable(post: Post): boolean {
  return has(post.caption) || has(post.script) || has(post.hook);
}

/** Aggregate progress for a whole series, for the card summary. */
export function seriesProgress(posts: Post[], totalParts: number): {
  posted: number;
  inProduction: number;
  total: number;
} {
  const posted = posts.filter((p) => p.status === 'posted').length;
  const inProduction = posts.filter(
    (p) => p.status !== 'posted' && resolveSeriesStage(p) > 0,
  ).length;
  return { posted, inProduction, total: totalParts };
}
