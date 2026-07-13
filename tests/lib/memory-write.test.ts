import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/feature-flags', () => ({ isEnabled: vi.fn() }));
vi.mock('@/lib/supermemory', () => ({ addMemory: vi.fn(), listMemories: vi.fn(), deleteMemory: vi.fn() }));

import { writeToMemory, buildPostMemoryCustomId, memoryScopeTag } from '@/lib/memory/write';
import { isEnabled } from '@/lib/feature-flags';
import { addMemory } from '@/lib/supermemory';

const isEnabledMock = isEnabled as unknown as ReturnType<typeof vi.fn>;
const addMemoryMock = addMemory as unknown as ReturnType<typeof vi.fn>;
const client = {} as never;

const baseArgs = {
  userId: 'u1',
  workspaceId: null,
  kind: 'imported_post' as const,
  content: 'hello world',
  customId: 'post_linkedin_1',
  metadata: { platform: 'linkedin' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('buildPostMemoryCustomId', () => {
  it('keys on the platform URN when a provider id exists', () => {
    expect(buildPostMemoryCustomId('linkedin', 'urn:123', 'abc')).toBe('post_linkedin_urn:123');
  });
  it('falls back to the internal id for drafts with no provider id', () => {
    expect(buildPostMemoryCustomId('linkedin', null, 'abc')).toBe('post_abc');
    expect(buildPostMemoryCustomId(null, 'urn:1', 'abc')).toBe('post_abc');
  });
});

describe('memoryScopeTag', () => {
  it('uses workspace tag when present, else user tag', () => {
    expect(memoryScopeTag('u1', 'w1')).toBe('workspace_w1');
    expect(memoryScopeTag('u1', null)).toBe('user_u1');
  });
});

describe('writeToMemory', () => {
  it('writes and returns true when the flag is on', async () => {
    isEnabledMock.mockResolvedValue(true);
    addMemoryMock.mockResolvedValue({ id: 'doc1' });
    const ok = await writeToMemory(client, baseArgs);
    expect(ok).toBe(true);
    expect(addMemoryMock).toHaveBeenCalledTimes(1);
    const call = addMemoryMock.mock.calls[0][0];
    expect(call.containerTags).toEqual(['user_u1', 'imported_post']);
    expect(call.customId).toBe('post_linkedin_1');
    expect(call.metadata).toMatchObject({ type: 'imported_post', platform: 'linkedin' });
  });

  it('skips and returns false when the flag is off', async () => {
    isEnabledMock.mockResolvedValue(false);
    const ok = await writeToMemory(client, baseArgs);
    expect(ok).toBe(false);
    expect(addMemoryMock).not.toHaveBeenCalled();
  });

  it('skips empty content without even checking the flag', async () => {
    const ok = await writeToMemory(client, { ...baseArgs, content: '   ' });
    expect(ok).toBe(false);
    expect(isEnabledMock).not.toHaveBeenCalled();
    expect(addMemoryMock).not.toHaveBeenCalled();
  });

  it('swallows a write error and returns false (never throws to the caller)', async () => {
    isEnabledMock.mockResolvedValue(true);
    addMemoryMock.mockRejectedValue(new Error('supermemory down'));
    const ok = await writeToMemory(client, baseArgs);
    expect(ok).toBe(false);
  });

  it('uses the workspace scope tag when a workspaceId is given', async () => {
    isEnabledMock.mockResolvedValue(true);
    addMemoryMock.mockResolvedValue({ id: 'doc1' });
    await writeToMemory(client, { ...baseArgs, workspaceId: 'w9' });
    expect(addMemoryMock.mock.calls[0][0].containerTags[0]).toBe('workspace_w9');
  });
});
