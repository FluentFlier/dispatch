/**
 * Direct platform integrations (existing OAuth/BYOK flow).
 * Used when SOCIAL_PROVIDER_MODE=direct or AYRSHARE_API_KEY is unset.
 */
import type { SocialProvider, PublishPayload, PublishResult } from '@/lib/social/types';

export const directProvider: SocialProvider = {
  name: 'direct',

  async listAccounts(): Promise<never[]> {
    return [];
  },

  async publish(): Promise<PublishResult> {
    return {
      success: false,
      error: 'Use /api/publish for direct provider mode',
      provider: 'direct',
    };
  },
};
