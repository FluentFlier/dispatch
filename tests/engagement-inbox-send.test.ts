import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendUnipileCommentReply } = vi.hoisted(() => ({
  sendUnipileCommentReply: vi.fn().mockResolvedValue({
    provider_reply_id: 'reply-1',
    stubbed: false,
  }),
}));

vi.mock('@/lib/engagement/unipile-comments', () => ({
  unipileCommentsAvailable: () => true,
  sendUnipileCommentReply,
}));

import { sendEngagementReplies } from '@/lib/engagement/inbox';

function makeMockClient(handlers: Record<string, () => unknown>) {
  return {
    database: {
      from: vi.fn((table: string) => {
        const handler = handlers[table];
        const result = handler ? handler() : { data: null, error: null };

        const terminal = {
          eq: () => terminal,
          in: () => terminal,
          not: () => terminal,
          select: () => terminal,
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled),
        };

        if (table === 'comment_reply_queue' && handler) {
          const payload = handler();
          return {
            select: () => ({
              eq: () => ({
                in: () => Promise.resolve(payload),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          };
        }

        return terminal;
      }),
    },
  };
}

describe('sendEngagementReplies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses publish_jobs.provider_post_id as socialPostId, not the comment id', async () => {
    const queueRow = {
      id: 'q1',
      user_id: 'u1',
      post_comment_id: 'c1',
      draft_reply: 'Thanks for reading!',
      status: 'approved',
    };
    const comment = {
      id: 'c1',
      user_id: 'u1',
      post_id: 'post-1',
      platform: 'linkedin',
      provider_comment_id: 'comment-provider-99',
      comment_text: 'Great post',
    };

    const mockClient = makeMockClient({
      comment_reply_queue: () => ({ data: [queueRow], error: null }),
      post_comments: () => ({ data: [comment], error: null }),
      publish_jobs: () => ({
        data: [
          {
            post_id: 'post-1',
            platform: 'linkedin',
            provider_post_id: '7478897599899521024',
          },
        ],
        error: null,
      }),
    });

    const result = await sendEngagementReplies(mockClient as never, 'u1', {
      queueIds: ['q1'],
    });

    expect(result.sent).toBe(1);
    expect(sendUnipileCommentReply).toHaveBeenCalledWith({
      userId: 'u1',
      socialPostId: '7478897599899521024',
      providerCommentId: 'comment-provider-99',
      platform: 'linkedin',
      replyText: 'Thanks for reading!',
    });
  });

  it('fails when no published post id exists for the comment', async () => {
    const queueRow = {
      id: 'q2',
      user_id: 'u1',
      post_comment_id: 'c2',
      draft_reply: 'Hello',
      status: 'approved',
    };
    const comment = {
      id: 'c2',
      user_id: 'u1',
      post_id: 'post-2',
      platform: 'linkedin',
      provider_comment_id: 'comment-x',
      comment_text: 'Nice',
    };

    const mockClient = makeMockClient({
      comment_reply_queue: () => ({ data: [queueRow], error: null }),
      post_comments: () => ({ data: [comment], error: null }),
      publish_jobs: () => ({ data: [], error: null }),
    });

    const result = await sendEngagementReplies(mockClient as never, 'u1', {
      queueIds: ['q2'],
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(sendUnipileCommentReply).not.toHaveBeenCalled();
  });
});
