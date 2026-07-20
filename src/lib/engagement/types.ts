export type ReplyQueueStatus = 'draft' | 'approved' | 'sent' | 'skipped' | 'failed';

export interface PostCommentRow {
  id: string;
  user_id: string;
  post_id: string;
  platform: string;
  provider_comment_id: string;
  author_name: string | null;
  author_handle: string | null;
  author_headline: string | null;
  comment_text: string;
  commented_at: string | null;
  parent_comment_id: string | null;
  /** True when the account owner wrote this - i.e. it is their own reply. */
  is_own: boolean | null;
  synced_at: string;
  // --- L5: Engagement Signal Detection ---
  // Set by draftEngagementReplies after Haiku signal check.
  // Drives the 💡 indicator in the inbox UI.
  is_content_signal: boolean | null;
  content_angle: string | null;
  signal_processed_at: string | null;
}

export interface CommentReplyQueueRow {
  id: string;
  user_id: string;
  post_comment_id: string;
  draft_reply: string;
  status: ReplyQueueStatus;
  voice_match_score: number | null;
  evaluation: Record<string, unknown> | null;
  sent_at: string | null;
  provider_reply_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboxComment {
  comment: PostCommentRow;
  queue: CommentReplyQueueRow | null;
  /** The creator already replied to this on the platform itself. */
  answered_natively?: boolean;
}

export interface InboxPostGroup {
  post_id: string;
  post_title: string;
  post_platform: string;
  provider_post_id: string | null;
  comments: InboxComment[];
  stats: {
    total: number;
    needs_reply: number;
    drafted: number;
    sent: number;
  };
}

export interface EngagementInboxResult {
  groups: InboxPostGroup[];
  summary: {
    posts: number;
    comments: number;
    needs_reply: number;
    drafted: number;
    sent: number;
  };
  /** False when Unipile is not configured - UI must block Approve & Send. */
  canSendReplies: boolean;
}

export interface ManualSyncComment {
  post_id: string;
  platform: string;
  provider_comment_id: string;
  comment_text: string;
  author_name?: string;
  author_handle?: string;
  author_headline?: string;
  commented_at?: string;
  parent_provider_comment_id?: string;
}

export interface SyncEngagementInput {
  postIds?: string[];
  manual?: ManualSyncComment[];
  /** Attempt Unipile GET /comments for published jobs (default true when UNIPILE_API_KEY set) */
  fetchFromProvider?: boolean;
  /** Also pull reactions per post (default true; costs one extra Unipile action per post) */
  includeReactions?: boolean;
}

export interface SyncEngagementResult {
  synced: number;
  inserted: number;
  updated: number;
  skipped: number;
  provider_fetched: number;
  reactions_fetched: number;
  reactions_inserted: number;
  reactions_skipped: number;
  errors: string[];
}

/** Row shape of the post_reactions table (see db/engagement-analytics.sql). */
export interface PostReactionRow {
  id: string;
  user_id: string;
  post_id: string;
  platform: string;
  reaction_type: string;
  author_key: string;
  author_name: string | null;
  author_handle: string | null;
  author_headline: string | null;
  author_profile_url: string | null;
  is_company: boolean;
  synced_at: string;
}

export interface DraftRepliesInput {
  commentIds?: string[];
  fast?: boolean;
  limit?: number;
}

export interface DraftRepliesResult {
  drafted: number;
  skipped: number;
  errors: string[];
  items: Array<{
    comment_id: string;
    queue_id: string;
    draft_reply: string;
    voice_match_score: number;
  }>;
}

export interface SendRepliesInput {
  queueIds?: string[];
  /** Approve drafts before send when true */
  approveFirst?: boolean;
  /** Override draft text before send (queue id → reply text) */
  draftOverrides?: Record<string, string>;
}

export interface SendRepliesResult {
  sent: number;
  failed: number;
  stubbed: number;
  errors: string[];
  /** False when Unipile is unavailable - callers should treat as non-success. */
  canSend?: boolean;
  items: Array<{
    queue_id: string;
    status: ReplyQueueStatus;
    provider_reply_id: string | null;
  }>;
}
