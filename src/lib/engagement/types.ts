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
  synced_at: string;
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
  /** Attempt Ayrshare GET /comments for published jobs (default true when AYRSHARE_API_KEY set) */
  fetchFromProvider?: boolean;
}

export interface SyncEngagementResult {
  synced: number;
  inserted: number;
  updated: number;
  skipped: number;
  provider_fetched: number;
  errors: string[];
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
  items: Array<{
    queue_id: string;
    status: ReplyQueueStatus;
    provider_reply_id: string | null;
  }>;
}
