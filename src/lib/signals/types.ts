/** Content OS Signals — shared types */

export type SignalPlatform = 'x' | 'linkedin';

export type SignalSourceType =
  | 'account'
  | 'company_page'
  | 'person_profile'
  | 'keyword_search';

export type SignalType =
  | 'accelerator_join'
  | 'funding_round'
  | 'role_change'
  | 'launch'
  | 'other';

export type SignalEventStatus =
  | 'pending'
  | 'drafted'
  | 'sent'
  | 'dismissed'
  | 'failed';

export type SignalActionMode =
  | 'notify_only'
  | 'notify_and_draft'
  | 'auto_send';

export type OutreachChannel =
  | 'linkedin_connect'
  | 'linkedin_dm'
  | 'x_dm'
  | 'gmail'
  | 'copy';

export interface SignalSourceRow {
  id: string;
  workspace_id: string;
  platform: SignalPlatform;
  handle_or_url: string;
  source_type: SignalSourceType;
  label: string | null;
  enabled: boolean;
  poll_interval_minutes: number;
  last_polled_at: string | null;
  cursor_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SignalRuleRow {
  id: string;
  workspace_id: string;
  name: string;
  platform: SignalPlatform | 'any' | null;
  conditions: Record<string, unknown>;
  action_mode: SignalActionMode;
  channels: string[];
  enabled: boolean;
}

export interface SignalRawPostRow {
  id: string;
  workspace_id: string;
  source_id: string | null;
  platform: SignalPlatform;
  external_post_id: string;
  author_handle: string | null;
  author_name: string | null;
  content: string;
  post_url: string | null;
  posted_at: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface SignalEventRow {
  id: string;
  workspace_id: string;
  raw_post_id: string | null;
  signal_type: SignalType;
  company_name: string | null;
  person_name: string | null;
  accelerator_name: string | null;
  batch: string | null;
  signal_summary: string | null;
  confidence: number;
  dedupe_key: string | null;
  status: SignalEventStatus;
  created_at: string;
  updated_at: string;
}

export interface SignalOutreachRow {
  id: string;
  workspace_id: string;
  event_id: string;
  channel: OutreachChannel;
  status: string;
  draft_text: string | null;
  final_text: string | null;
  template_id: string | null;
  sent_at: string | null;
  error: string | null;
  target_linkedin_identifier: string | null;
  linkedin_provider_id: string | null;
}

/** Normalized post from webhook, Unipile, Apify, or manual ingest */
export interface IngestedPost {
  platform: SignalPlatform;
  externalPostId: string;
  authorHandle?: string;
  authorName?: string;
  content: string;
  postUrl?: string;
  postedAt?: string;
  rawPayload?: Record<string, unknown>;
}

export interface ClassifiedSignal {
  signalType: SignalType;
  companyName?: string;
  personName?: string;
  acceleratorName?: string;
  batch?: string;
  signalSummary: string;
  confidence: number;
  dedupeKey: string;
  matchedKeywords: string[];
}

export interface SignalEventWithPost extends SignalEventRow {
  raw_post?: SignalRawPostRow | null;
  outreach?: SignalOutreachRow | null;
}
