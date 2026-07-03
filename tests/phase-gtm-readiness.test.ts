import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/engagement/unipile-comments', () => ({
  unipileCommentsAvailable: () => true,
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
    it('does not mark queue rows as sent when Unipile is stubbed', async () => {
      const updates: unknown[] = [];
      const mockClient = {
        database: {
          from: vi.fn((table: string) => {
            if (table === 'comment_reply_queue') {
              return {
                select: () => ({
                  eq: () => ({
                    in: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: 'q1',
                            user_id: 'u1',
                            post_comment_id: 'c1',
                            draft_reply: 'Thanks!',
                            status: 'approved',
                          },
                        ],
                      }),
                  }),
                }),
                update: (patch: unknown) => {
                  updates.push(patch);
                  return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
                },
              };
            }
            if (table === 'post_comments') {
              return {
                select: () => ({
                  eq: () => ({
                    in: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: 'c1',
                            provider_comment_id: 'pc1',
                            platform: 'linkedin',
                          },
                        ],
                      }),
                  }),
                }),
              };
            }
            return {};
          }),
        },
      };

      const result = await sendEngagementReplies(mockClient as never, 'u1', { queueIds: ['q1'] });

      expect(result.stubbed).toBe(1);
      expect(result.sent).toBe(0);
      expect(updates.some((u) => (u as { status?: string }).status === 'sent')).toBe(false);
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
