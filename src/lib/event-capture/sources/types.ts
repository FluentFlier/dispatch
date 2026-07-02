/**
 * Source-agnostic event shape produced by every detection source
 * (Composio calendar, LinkedIn-post scan). The ingest helper consumes this,
 * so adding a new source never touches the upsert logic.
 */
export interface NormalizedEvent {
  /** Stable id from the source (calendar event id, or `li_<postId>` for LinkedIn). */
  providerEventId: string;
  /** 'google' for calendar, 'linkedin' for post-derived events. */
  source: 'google' | 'linkedin';
  title: string;
  description?: string | null;
  location?: string | null;
  /** Names only (no emails) unless consent stored elsewhere. */
  attendees?: Array<{ name: string }> | null;
  startTime: Date;
  endTime: Date;
}
