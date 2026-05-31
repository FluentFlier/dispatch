/** Core brain page slugs: one namespace per creator on InsForge */
export const BRAIN_SLUG = {
  voice: 'voice',
  profile: 'profile',
  wins: 'wins',
  post: (postId: string) => `post/${postId}`,
  story: (storyId: string) => `story/${storyId}`,
} as const;

export interface BrainPageRecord {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  tags: string[];
  body: string;
  updated_at: string;
}

export interface BrainProvisionResult {
  ok: boolean;
  page_count: number;
  slugs: string[];
  message: string;
}

export interface BrainStatus {
  provisioned: boolean;
  page_count: number;
  slugs: string[];
  last_updated: string | null;
}
