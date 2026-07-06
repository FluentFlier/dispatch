export type WarmContactStatus = 'new' | 'drafted' | 'sent' | 'dismissed';

export type WarmContactCategory = 'ICP' | 'Community' | 'Potential Lead' | 'Other';

export interface WarmContactRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  platform: string;
  provider_profile_id: string | null;
  public_identifier: string | null;
  display_name: string | null;
  headline: string | null;
  profile_url: string | null;
  reaction_type: string | null;
  source_post_id: string | null;
  source_post_title: string | null;
  category: WarmContactCategory;
  status: WarmContactStatus;
  outreach_draft: string | null;
  outreach_channel: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface PostReaction {
  providerProfileId?: string;
  publicIdentifier?: string;
  displayName?: string;
  headline?: string;
  profileUrl?: string;
  reactionType?: string;
}

export interface WarmContactsSyncResult {
  postsScanned: number;
  reactionsFetched: number;
  contactsUpserted: number;
  errors: string[];
}

export interface WarmContactsListResult {
  contacts: WarmContactRow[];
  buckets: Record<WarmContactCategory, WarmContactRow[]>;
  summary: {
    total: number;
    new: number;
    icp: number;
  };
  meta: {
    cache_ttl_seconds: number;
    last_sync_hint: string;
  };
}
