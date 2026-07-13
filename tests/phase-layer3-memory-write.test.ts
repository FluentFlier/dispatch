/**
 * Phase: Layer 3 - Memory Write Path
 * Verifies workspace scoping for brain pages, addMemory wiring in
 * syncBrainPublishedPost, and workspace-scoped Supermemory container tags.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Top-level vi.mock for supermemory — hoisted by vitest so it always wins.
// We control behaviour per-test by mutating addMemoryImpl.
// ---------------------------------------------------------------------------

let addMemoryImpl: (params: unknown) => Promise<unknown> = vi.fn();

vi.mock('../src/lib/supermemory', () => ({
  addMemory: (params: unknown) => addMemoryImpl(params),
}));

// ---------------------------------------------------------------------------
// Helper — builds a minimal InsForge client stub for brain/sync tests
// ---------------------------------------------------------------------------

function makeClient(options: {
  postRow?: Record<string, unknown> | null;
  flagEnabled?: boolean;
} = {}) {
  const { postRow = null, flagEnabled = true } = options;

  const flagSingle = vi.fn().mockResolvedValue({ data: { enabled: flagEnabled }, error: null });
  const upsertFn = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: 'page-id', user_id: 'u', slug: 's', title: 'T', tags: [], body: '{}', updated_at: '' },
      error: null,
    }),
  });

  return {
    database: {
      from: vi.fn((table: string) => {
        if (table === 'feature_flags') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: flagSingle,
            maybeSingle: flagSingle,
          };
        }
        if (table === 'posts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: postRow, error: null }),
          };
        }
        if (table === 'publish_jobs') {
          // URN lookup for the memory customId; null keeps the fallback id.
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { provider_post_id: null }, error: null }),
          };
        }
        // creator_brain_pages
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), upsert: upsertFn };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// brain/pages.ts workspace scoping
// ---------------------------------------------------------------------------

describe('Layer 3: Memory Write Path', () => {
  describe('brain/pages.ts workspace scoping', () => {
    it('listBrainPages filters by workspace_id when provided', async () => {
      const { listBrainPages } = await import('../src/lib/brain/pages');
      const eqSpy = vi.fn().mockReturnThis();
      const orderSpy = vi.fn().mockResolvedValue({ data: [], error: null });

      const client = {
        database: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: eqSpy,
            order: orderSpy,
          }),
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await listBrainPages(client as any, 'user-1', 'ws-abc');

      const eqCalls = eqSpy.mock.calls as Array<[string, string]>;
      const hasWorkspaceEq = eqCalls.some(
        ([col, val]) => col === 'workspace_id' && val === 'ws-abc',
      );
      expect(hasWorkspaceEq).toBe(true);
    });

    it('listBrainPages returns all user pages when workspaceId omitted', async () => {
      const { listBrainPages } = await import('../src/lib/brain/pages');
      const eqSpy = vi.fn().mockReturnThis();
      const orderSpy = vi.fn().mockResolvedValue({ data: [], error: null });

      const client = {
        database: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: eqSpy,
            order: orderSpy,
          }),
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await listBrainPages(client as any, 'user-1');

      const eqCalls = eqSpy.mock.calls as Array<[string, string]>;
      // Must NOT have called .eq('workspace_id', ...) — no workspace filter
      const hasWorkspaceEq = eqCalls.some(([col]) => col === 'workspace_id');
      expect(hasWorkspaceEq).toBe(false);
      // Must still have filtered by user_id
      const hasUserEq = eqCalls.some(([col]) => col === 'user_id');
      expect(hasUserEq).toBe(true);
    });

    it('getBrainPage filters by workspace_id when provided', async () => {
      const { getBrainPage } = await import('../src/lib/brain/pages');
      const eqSpy = vi.fn().mockReturnThis();
      const maybeSingleSpy = vi.fn().mockResolvedValue({ data: null, error: null });

      const client = {
        database: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: eqSpy,
            maybeSingle: maybeSingleSpy,
          }),
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getBrainPage(client as any, 'user-1', 'voice', 'ws-xyz');

      const eqCalls = eqSpy.mock.calls as Array<[string, string]>;
      const hasWorkspaceEq = eqCalls.some(
        ([col, val]) => col === 'workspace_id' && val === 'ws-xyz',
      );
      expect(hasWorkspaceEq).toBe(true);
    });

    it('putBrainPage includes workspace_id in upsert when provided', async () => {
      const { putBrainPage } = await import('../src/lib/brain/pages');
      const upsertCalls: Record<string, unknown>[] = [];

      const client = {
        database: {
          from: vi.fn().mockReturnValue({
            upsert: vi.fn((payload: Record<string, unknown>) => {
              upsertCalls.push(payload);
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: { ...payload, id: 'p1', updated_at: new Date().toISOString() },
                  error: null,
                }),
              };
            }),
          }),
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await putBrainPage(client as any, 'user-1', {
        slug: 'voice',
        title: 'Voice',
        body: '{}',
        workspaceId: 'ws-123',
      });

      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0]).toMatchObject({ workspace_id: 'ws-123' });
    });
  });

  // ---------------------------------------------------------------------------
  // syncBrainPublishedPost addMemory wiring
  // Tests use the top-level vi.mock of supermemory and mutate addMemoryImpl
  // per test so there are no doMock / module-registry pollution issues.
  // ---------------------------------------------------------------------------

  describe('syncBrainPublishedPost', () => {
    const basePostRow = {
      id: 'post-1',
      title: 'Test Post',
      pillar: 'personal_brand',
      platform: 'linkedin',
      caption: 'Test caption',
      script: null,
      hook: 'Test hook',
      views: 500,
      likes: 10,
      posted_date: '2026-01-01',
    };

    beforeEach(() => {
      // Reset to a clean no-op before each test
      addMemoryImpl = vi.fn().mockResolvedValue({ id: 'mem-id' });
    });

    it('calls addMemory with workspace_ tag when workspaceId provided', async () => {
      const { syncBrainPublishedPost } = await import('../src/lib/brain/sync');
      const client = makeClient({ postRow: basePostRow, flagEnabled: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await syncBrainPublishedPost(client as any, 'user-1', 'post-1', 'ws-abc');

      const addMemoryMock = addMemoryImpl as ReturnType<typeof vi.fn>;
      expect(addMemoryMock).toHaveBeenCalledOnce();
      const call = addMemoryMock.mock.calls[0][0] as { containerTags: string[]; customId: string };
      expect(call.containerTags).toContain('workspace_ws-abc');
      expect(call.containerTags).not.toContain('user_user-1');
      expect(call.customId).toBe('post_post-1');
    });

    it('calls addMemory with user_ tag when workspaceId not provided', async () => {
      const postRow2 = {
        id: 'post-2', title: 'Post Two', pillar: 'thought_leadership',
        platform: 'twitter', caption: null, script: 'Script text',
        hook: 'Hook text', views: null, likes: null, posted_date: null,
      };
      const { syncBrainPublishedPost } = await import('../src/lib/brain/sync');
      const client = makeClient({ postRow: postRow2, flagEnabled: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await syncBrainPublishedPost(client as any, 'user-2', 'post-2');

      const addMemoryMock = addMemoryImpl as ReturnType<typeof vi.fn>;
      expect(addMemoryMock).toHaveBeenCalledOnce();
      const call = addMemoryMock.mock.calls[0][0] as { containerTags: string[] };
      expect(call.containerTags).toContain('user_user-2');
      expect(call.containerTags.some((t: string) => t.startsWith('workspace_'))).toBe(false);
    });

    it('does not throw if addMemory fails — logs error', async () => {
      addMemoryImpl = vi.fn().mockRejectedValue(new Error('Supermemory down'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const postRow3 = {
        id: 'post-3', title: 'Post Three', pillar: 'education',
        platform: 'linkedin', caption: 'Caption text', script: null,
        hook: null, views: null, likes: null, posted_date: null,
      };
      const { syncBrainPublishedPost } = await import('../src/lib/brain/sync');
      const client = makeClient({ postRow: postRow3, flagEnabled: true });

      // Must not throw even when addMemory rejects
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(syncBrainPublishedPost(client as any, 'user-3', 'post-3')).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[memory] write failed'),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it('skips addMemory when layer3_memory_writes flag is false', async () => {
      const postRow4 = {
        id: 'post-4', title: 'Post Four', pillar: 'personal_brand',
        platform: 'linkedin', caption: 'Caption text', script: null,
        hook: 'Hook text', views: 100, likes: 5, posted_date: '2026-01-02',
      };
      const { syncBrainPublishedPost } = await import('../src/lib/brain/sync');
      // Flag returns false — memory writes disabled
      const client = makeClient({ postRow: postRow4, flagEnabled: false });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await syncBrainPublishedPost(client as any, 'user-4', 'post-4', 'ws-skip');

      const addMemoryMock = addMemoryImpl as ReturnType<typeof vi.fn>;
      // addMemory must NOT be called when flag is off
      expect(addMemoryMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // supermemory.ts workspace scoping
  // These tests import the REAL supermemory module by bypassing the vi.mock
  // via a dynamic re-import that we can control. Since vi.mock replaces the
  // module with only { addMemory }, we use the actual functions directly
  // by testing their behaviour through storePersona / searchUserContext
  // which are defined in the real module.
  //
  // To get the real module we use importOriginal pattern via vi.importActual.
  // ---------------------------------------------------------------------------

  describe('supermemory workspace scoping', () => {
    beforeEach(() => {
      process.env.SUPERMEMORY_API_KEY = 'test-key';
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('storePersona uses workspace_${workspaceId} tag when provided', async () => {
      const fetchCalls: Array<RequestInit> = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        fetchCalls.push(init);
        return { ok: true, status: 200, json: async () => ({ id: 'mem-id' }) };
      }));

      // importActual bypasses the vi.mock and loads the real module.
      const { storePersona } = await vi.importActual<typeof import('../src/lib/supermemory')>(
        '../src/lib/supermemory',
      );
      await storePersona('user-1', 'My persona', undefined, 'ws-abc');

      expect(fetchCalls).toHaveLength(1);
      const body = JSON.parse(fetchCalls[0].body as string) as { containerTags: string[] };
      expect(body.containerTags).toContain('workspace_ws-abc');
      expect(body.containerTags).not.toContain('user_user-1');
    });

    it('storePersona falls back to user_${userId} tag when no workspaceId', async () => {
      const fetchCalls: Array<RequestInit> = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        fetchCalls.push(init);
        return { ok: true, status: 200, json: async () => ({ id: 'mem-id' }) };
      }));

      const { storePersona } = await vi.importActual<typeof import('../src/lib/supermemory')>(
        '../src/lib/supermemory',
      );
      await storePersona('user-2', 'My persona');

      expect(fetchCalls).toHaveLength(1);
      const body = JSON.parse(fetchCalls[0].body as string) as { containerTags: string[] };
      expect(body.containerTags).toContain('user_user-2');
      expect(body.containerTags.some((t: string) => t.startsWith('workspace_'))).toBe(false);
    });

    it('searchUserContext searches workspace tag when provided', async () => {
      const fetchCalls: Array<RequestInit> = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        fetchCalls.push(init);
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      }));

      const { searchUserContext } = await vi.importActual<typeof import('../src/lib/supermemory')>(
        '../src/lib/supermemory',
      );
      await searchUserContext('user-3', 'some query', 5, 'ws-xyz');

      expect(fetchCalls).toHaveLength(1);
      const body = JSON.parse(fetchCalls[0].body as string) as { containerTags: string[] };
      expect(body.containerTags).toContain('workspace_ws-xyz');
      expect(body.containerTags).not.toContain('user_user-3');
    });
  });
});
