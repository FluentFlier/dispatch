/** Content OS Signals - shared types */

export type ConversionStage = 'interested' | 'meeting_booked' | 'not_now' | 'won' | 'lost';

export type NurtureStage =
  | 'discovered'
  | 'planned'
  | 'engaging'
  | 'connect_ready'
  | 'connect_sent'
  | 'nurturing'
  | 'dm_ready'
  | 'dm_sent'
  | 'replied'
  | 'closed';

export interface LeadPlaybook {
  whyThem: string;
  angle: string;
  steps: Array<{
    type: 'research' | 'comment' | 'connect' | 'dm';
    label: string;
    dueInDays: number;
    status: 'pending' | 'done' | 'skipped';
  }>;
  hookContext?: string;
  generatedAt: string;
  /** Best recent post to comment on (Unipile or The Hog). */
  targetPost?: {
    id: string;
    excerpt: string;
    url?: string;
    source: 'unipile' | 'thehog';
  };
  commentTaskId?: string;
  /** All queued comment-task ids when warming up across several of the prospect's posts. */
  commentTaskIds?: string[];
}

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
  | 'other'
  | 'keyword_match';

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
  | 'linkedin_follow'
  | 'linkedin_comment'
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

// --- Directory Lead Engine ---

export type LeadSource =
  | 'web_discovery'
  | 'yc_directory'
  | 'yc_launches'
  | 'product_hunt'
  | 'linkedin'
  | 'x'
  | 'manual';

export type LeadContactStatus = 'unresolved' | 'resolved' | 'no_contact';

export type LeadStatus =
  | 'new'
  | 'drafted'
  | 'approved'
  | 'sent'
  | 'dismissed'
  | 'resurfaced';

export type LeadEventType =
  | 'scraped'
  | 'new'
  | 'rescored'
  | 'reactivated'
  | 'resolved'
  | 'unresolved'
  | 'renamed'
  | 'pivoted'
  | 'merged';

/** Flags that drive reactivation + intent boost. */
export interface LeadIntentFlags {
  hiring?: boolean;
  raised?: boolean;
  seeking_investors?: boolean;
  seeking_tools?: boolean;
}

/**
 * Compact rich company facts persisted on the lead (jsonb `company_detail`) so
 * the draft prompt can reference description / headcount / industry without a
 * re-scrape. Seeded from the Algolia hit at ingest, then completed once from the
 * YC detail page at first draft (`fetchedAt` marks a full fetch).
 */
export interface LeadCompanyDetail {
  description?: string;
  teamSize?: number;
  industries?: string[];
  location?: string;
  status?: string;
  yearFounded?: number;
  /** ISO timestamp of the one-time full detail-page fetch; absent = seed only. */
  fetchedAt?: string;
  /** Where a fallback description came from when one was fetched live. */
  description_source?: 'linkedin' | 'web';
  /** Legacy permanent latch; superseded by description_checked_at. */
  description_checked?: boolean;
  /** When we last tried and found nothing; rechecked after a TTL, not latched forever. */
  description_checked_at?: string;
}

export interface SignalLeadRow {
  id: string;
  workspace_id: string;
  source: LeadSource;
  external_id: string | null;
  company_name: string;
  tagline: string | null;
  website: string | null;
  domain: string | null;
  batch: string | null;
  tags: string[];
  intent_flags: LeadIntentFlags;
  source_fact: Record<string, unknown>;
  /** Rich company facts persisted for reuse in the draft prompt (see type). */
  company_detail?: LeadCompanyDetail | null;
  name_history: string[];
  fit_score: number;
  rank_score: number;
  contact_status: LeadContactStatus;
  lead_status: LeadStatus;
  nurture_stage?: NurtureStage | string | null;
  playbook?: LeadPlaybook | Record<string, unknown> | null;
  next_action_at?: string | null;
  needs_reply?: boolean;
  unipile_chat_id?: string | null;
  last_inbound_at?: string | null;
  conversion_stage?: ConversionStage | string | null;
  /** Hide from the feed until this timestamp (null = not snoozed). */
  snoozed_until?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  digest_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalLeadContactRow {
  id: string;
  lead_id: string;
  workspace_id: string;
  name: string | null;
  role: string | null;
  linkedin_url: string | null;
  x_handle: string | null;
  email: string | null;
  provider_id: string | null;
  resolution_source: 'scraped' | 'enriched' | 'manual' | null;
  enriched_via: string | null;
  is_primary: boolean;
  /** True once the LinkedIn URL was confirmed via the workspace Unipile account. */
  linkedin_verified?: boolean;
  /** ISO timestamp of the last verification attempt that succeeded, else null. */
  linkedin_verified_at?: string | null;
  created_at: string;
}

export interface SignalLeadWithContacts extends SignalLeadRow {
  contacts?: SignalLeadContactRow[];
  primary_contact?: SignalLeadContactRow | null;
  outreach?: SignalOutreachRow | null;
}

export interface DirectorySettingsRow {
  workspace_id: string;
  enabled_sources: LeadSource[];
  /** Natural-language ICP description (BigSet-style intake). */
  icp_description: string | null;
  icp_verticals: string[];
  icp_keywords: string[];
  recency_window: string;
  digest_run_hour_local: number;
  digest_timezone: string | null;
  digest_channels: { today: boolean; slack: boolean; email: boolean };
  digest_top_n: number;
  sender_identity: string | null;
  /** Scheduling URL (Calendly, Google Calendar, etc.) for reply/DM drafts. */
  meeting_link: string | null;
  digest_delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * What an agenda is trying to achieve. Drives the outreach angle, copy rules,
 * and which sequence steps run. Add a variant here and the `never` checks in
 * agenda.ts force every switch to handle it.
 */
export type AgendaGoalType =
  | 'networking'
  | 'customer_acquisition'
  | 'hiring'
  | 'fundraising'
  | 'other';

/** Where an agenda draws people/companies from. */
export type AgendaSource = 'engagers' | 'directory' | 'signals';

/**
 * A named, saved ICP - now a full "agenda": a goal (goal_type) with its own
 * pitch angle, tone rules, daily caps, and sources. A workspace can keep
 * several; the active one is mirrored into `signal_directory_settings` so the
 * existing discovery/scoring pipeline reads it unchanged.
 */
export interface IcpProfileRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  verticals: string[];
  keywords: string[];
  is_active: boolean;
  goal_type: AgendaGoalType;
  target_personas: string[];
  pitch_angle: string | null;
  tone_rules: string | null;
  daily_connect_limit: number;
  daily_comment_limit: number;
  sources: AgendaSource[];
  created_at: string;
  updated_at: string;
}

export interface FollowedCompanyRow {
  id: string;
  workspace_id: string;
  company_name: string;
  domain: string | null;
  external_id: string | null;
  added_by_user_id: string | null;
  created_at: string;
}

/** Normalized lead from a directory scrape (TinyFish) or seed. */
export interface IngestedLead {
  source: LeadSource;
  externalId: string;
  companyName: string;
  tagline?: string;
  /** Longer company description captured at scrape time (seeds company_detail). */
  longDescription?: string;
  /** Provenance URL of the scrape (e.g. LinkedIn company page), stored in source_fact. */
  sourceUrl?: string;
  website?: string;
  batch?: string;
  tags?: string[];
  intentFlags?: LeadIntentFlags;
  founders?: Array<{
    name?: string;
    role?: string;
    linkedinUrl?: string;
    xHandle?: string;
    email?: string;
  }>;
}
