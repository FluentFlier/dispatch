/**
 * Pure view-state helpers for the Leads feed, so the audit fixes (WS3) are
 * unit-testable without rendering React.
 */

/** What the feed area should render. `error` is a FAILED fetch, not an empty feed. */
export type FeedViewState = 'loading' | 'setup' | 'error' | 'empty' | 'list';

/**
 * Distinguish a failed bootstrap fetch from a genuinely empty feed so the UI
 * shows a retry instead of the misleading "No leads yet today" empty state.
 * `setup` is when the leads/signals schema (or flag) is not provisioned.
 */
export function feedViewState(opts: {
  loading: boolean;
  loadError: boolean;
  cardCount: number;
  setupRequired?: boolean;
}): FeedViewState {
  if (opts.loading) return 'loading';
  if (opts.setupRequired) return 'setup';
  if (opts.loadError) return 'error';
  if (opts.cardCount === 0) return 'empty';
  return 'list';
}

/** Columns of the CRM pipeline view, in funnel order. */
export const PIPELINE_COLUMNS = [
  { key: 'contacted', label: 'Contacted' },
  { key: 'in_conversation', label: 'In conversation' },
  { key: 'meeting_booked', label: 'Meeting booked' },
  { key: 'closed', label: 'Closed' },
] as const;
export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number]['key'];

/**
 * Which pipeline column a lead belongs to, or null when it has not been
 * contacted yet (pre-funnel leads live in the feed, not the pipeline).
 * conversion_stage (explicit user calls) wins over derived outreach state.
 */
export function pipelineColumn(lead: {
  lead_status: string;
  nurture_stage?: string | null;
  conversion_stage?: string | null;
  needs_reply?: boolean;
}): PipelineColumn | null {
  const conv = lead.conversion_stage ?? null;
  if (conv === 'won' || conv === 'lost' || conv === 'not_now') return 'closed';
  if (conv === 'meeting_booked') return 'meeting_booked';
  if (
    lead.needs_reply ||
    lead.nurture_stage === 'replied' ||
    lead.nurture_stage === 'in_conversation' ||
    conv === 'interested'
  ) {
    return 'in_conversation';
  }
  if (lead.nurture_stage === 'closed') return 'closed';
  if (lead.lead_status === 'sent') return 'contacted';
  return null;
}

export interface DraftAllOutcome {
  message: string;
  type: 'success' | 'error';
}

/**
 * Toast copy for a "draft all" run. Reports failures instead of hiding them:
 * a run with any failure surfaces "X drafted, Y failed" as an error toast.
 */
export function draftAllOutcome(succeeded: number, failed: number): DraftAllOutcome {
  const plural = (n: number) => `${n} message${n === 1 ? '' : 's'}`;
  if (failed > 0) {
    return { message: `Drafted ${plural(succeeded)}, ${failed} failed.`, type: 'error' };
  }
  return { message: `Drafted ${plural(succeeded)}.`, type: 'success' };
}
