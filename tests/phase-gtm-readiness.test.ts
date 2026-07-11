import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/engagement/unipile-comments', () => ({
  unipileCommentsAvailable: () => false,
  sendUnipileCommentReply: vi.fn().mockResolvedValue({
    provider_reply_id: null,
    stubbed: true,
  }),
}));

import { sendEngagementReplies } from '@/lib/engagement/inbox';

describe('Phase: GTM creator readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('engagement send stub honesty', () => {
    it('fails closed when Unipile is unavailable (does not stub-send)', async () => {
      const mockClient = {
        database: {
          from: vi.fn(),
        },
      };

      await expect(
        sendEngagementReplies(mockClient as never, 'u1', { queueIds: ['q1'] }),
      ).rejects.toThrow(/Unipile is not configured/i);
      expect(mockClient.database.from).not.toHaveBeenCalled();
    });
  });

  describe('workspace watchlist loader', () => {
    it('falls back to defaults when table is empty', async () => {
      const mockClient = {
        database: {
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }),
        },
      };

      const { getWorkspaceWatchlistTargets } = await import('@/lib/hooks-intelligence/workspace-watchlist');
      const result = await getWorkspaceWatchlistTargets(mockClient as never, 'ws-1');
      expect(result.source).toBe('default');
      expect(result.handles.length).toBeGreaterThan(0);
    });
  });
});
