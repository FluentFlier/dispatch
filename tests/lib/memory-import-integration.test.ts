/**
 * Integration: imported posts actually land in memory.
 *
 * Drives the real persistImportedPosts through the real writeToMemory helper with
 * a mocked Supermemory + feature flag, asserting the dated header, sanitized URN
 * customId, and scope tag — and that a failed (empty-content) item writes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/feature-flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/supermemory', () => ({ addMemory: vi.fn().mockResolvedValue({ id: 'mem' }) }));

import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';
import { addMemory } from '@/lib/supermemory';

const addMemoryMock = addMemory as unknown as ReturnType<typeof vi.fn>;

/** Fake client: no existing job, inserts succeed. */
function fakeClient() {
  return {
    database: {
      from(table: string) {
        if (table === 'publish_jobs') {
          return {
            select: () => ({ eq: () => ({ limit: () => ({ data: [], error: null }) }) }),
            insert: () => ({ error: null }),
          };
        }
        return { insert: () => ({ error: null }) };
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('persistImportedPosts → memory', () => {
  it('writes each created post to memory with a dated header and sanitized URN customId', async () => {
    const client = fakeClient();
    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: 'ws1',
      platform: 'linkedin',
      items: [{ id: 'urn:li:activity:999', text: 'A substantial historical post worth remembering later.' }],
    });

    expect(addMemoryMock).toHaveBeenCalledTimes(1);
    const call = addMemoryMock.mock.calls[0][0];
    expect(call.customId).toBe('post_linkedin_urn_li_activity_999');
    expect(call.containerTags).toEqual(['workspace_ws1', 'imported_post']);
    expect(call.content).toContain('this ALREADY happened');
    expect(call.content).toContain('A substantial historical post');
    expect(call.metadata).toMatchObject({ type: 'imported_post', platform: 'linkedin' });
  });

  it('does not write memory for an item with no usable content', async () => {
    const client = fakeClient();
    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: 'ws1',
      platform: 'linkedin',
      items: [{ id: 'p-empty', text: '   ' }],
    });
    expect(addMemoryMock).not.toHaveBeenCalled();
  });

  it('writes one memory doc per created post across a batch', async () => {
    const client = fakeClient();
    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: null,
      platform: 'linkedin',
      items: [
        { id: 'a1', text: 'First real historical post with enough words to persist.' },
        { id: 'a2', text: 'Second real historical post with enough words to persist.' },
      ],
    });
    expect(addMemoryMock).toHaveBeenCalledTimes(2);
    // Null workspace → user-scoped tag.
    expect(addMemoryMock.mock.calls[0][0].containerTags[0]).toBe('user_u1');
  });
});
