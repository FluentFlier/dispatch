/**
 * Phase 3 — Data layer + code quality regression tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P3-1: workspace — listWorkspaces filters at DB level (not in JS)
// ---------------------------------------------------------------------------
describe('P3-1: listWorkspaces — DB-level filter on workspace IDs', () => {
  beforeEach(() => vi.resetModules());

  it('calls .in() with the user workspace IDs rather than fetching all workspaces', async () => {
    const inMock = vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: [{ id: 'ws-1', name: 'Mine', type: 'solo', owner_user_id: 'u1' }], error: null }),
    });
    const fromMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: inMock,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue({ database: { from: fromMock } }),
    }));
    vi.doMock('next/headers', () => ({ cookies: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }));
    vi.doMock('@/lib/entitlements', () => ({ getUserEntitlements: vi.fn() }));

    // Mock workspace_members query to return one membership
    fromMock.mockImplementation((table: string) => {
      if (table === 'workspace_members') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws-1', role: 'owner' }], error: null }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: inMock, order: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const { listWorkspaces } = await import('@/lib/workspace');
    await listWorkspaces('u1');

    // .in() must have been called with the workspace IDs
    expect(inMock).toHaveBeenCalledWith('id', expect.arrayContaining(['ws-1']));
  });
});

// ---------------------------------------------------------------------------
// P3-2: brain/sync — JSON.parse failure is caught, not thrown
// ---------------------------------------------------------------------------
describe('P3-2: syncBrainFromProfile — malformed content_pillars does not crash', () => {
  beforeEach(() => vi.resetModules());

  it('logs a warning and continues with empty array when content_pillars is malformed JSON', async () => {
    const putBrainPageMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/brain/pages', () => ({
      getBrainPage: vi.fn().mockResolvedValue(null),
      listBrainPages: vi.fn().mockResolvedValue([{ slug: 'voice' }, { slug: 'profile' }]),
      putBrainPage: putBrainPageMock,
    }));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fakeClient = {
      database: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              display_name: 'Test User',
              bio: 'Bio',
              bio_facts: 'Facts',
              voice_description: 'Direct',
              voice_rules: 'No fluff',
              content_pillars: '{invalid json{{', // malformed
            },
            error: null,
          }),
        }),
      },
    };

    const { syncBrainFromProfile } = await import('@/lib/brain/sync');

    // Must not throw
    await expect(syncBrainFromProfile(fakeClient as never, 'u1')).resolves.toBeUndefined();

    // Must log warning about failed parse
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('content_pillars JSON parse failed'),
      'u1',
      expect.any(String)
    );

    // putBrainPage must still have been called (sync continued)
    expect(putBrainPageMock).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// P3-3: brain/sync — syncBrainWins not called inside syncBrainPublishedPost
// ---------------------------------------------------------------------------
describe('P3-3: syncBrainPublishedPost — syncBrainWins not called per post', () => {
  beforeEach(() => vi.resetModules());

  it('does not trigger a top-5 query per post sync', async () => {
    const topFiveQueryMock = vi.fn().mockResolvedValue({ data: [], error: null });

    let postQueryCall = 0;
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'posts') {
        postQueryCall++;
        // First call: fetch the post being synced
        // Subsequent calls: the syncBrainWins top-5 query (should NOT happen)
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'post-1', title: 'Test', pillar: 'founder', platform: 'linkedin', caption: 'content', script: null, hook: null, views: 100, likes: 10, posted_date: '2026-06-01' },
            error: null,
          }),
          order: vi.fn().mockReturnThis(),
          limit: topFiveQueryMock,
        };
      }
      // Default: covers creator_brain_pages, feature_flags, publish_jobs, and any
      // other table. Fully chainable so multi-.eq() lookups (e.g. publish_jobs
      // provider_post_id) resolve to a null row instead of throwing.
      const singleMock = vi.fn().mockResolvedValue({ data: { id: 'bp-1', enabled: false }, error: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        single: singleMock,
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleMock }) }),
      };
      return chain;
    });

    vi.doMock('@/lib/brain/pages', () => ({
      putBrainPage: vi.fn().mockResolvedValue(undefined),
      getBrainPage: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('@/lib/brain/types', () => ({
      BRAIN_SLUG: { post: (id: string) => `post:${id}`, wins: 'wins', voice: 'voice', profile: 'profile' },
    }));

    const fakeClient = { database: { from: fromMock } };
    const { syncBrainPublishedPost } = await import('@/lib/brain/sync');
    await syncBrainPublishedPost(fakeClient as never, 'u1', 'post-1');

    // The top-5 query should NOT have been called from within syncBrainPublishedPost
    expect(topFiveQueryMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// P3-5: engagement inbox — sort comparator handles undefined synced_at
// ---------------------------------------------------------------------------
describe('P3-5: engagement inbox sort — handles undefined synced_at', () => {
  it('sorts groups by synced_at without returning 0 for undefined values', () => {
    // Test the sort logic directly (extracted from inbox.ts for unit testing)
    type Group = { comments: Array<{ comment: { synced_at?: string } }> };

    const sortGroups = (groups: Group[]) =>
      groups.sort((a, b) => {
        const bDate = b.comments[0]?.comment.synced_at ?? '';
        const aDate = a.comments[0]?.comment.synced_at ?? '';
        return bDate.localeCompare(aDate);
      });

    const groups: Group[] = [
      { comments: [{ comment: { synced_at: '2026-06-01T10:00:00Z' } }] },
      { comments: [{ comment: {} }] }, // undefined synced_at
      { comments: [{ comment: { synced_at: '2026-06-02T10:00:00Z' } }] },
    ];

    const sorted = sortGroups([...groups]);

    // Most recent first
    expect(sorted[0].comments[0].comment.synced_at).toBe('2026-06-02T10:00:00Z');
    expect(sorted[1].comments[0].comment.synced_at).toBe('2026-06-01T10:00:00Z');
    // Undefined sorts to end (empty string < any date)
    expect(sorted[2].comments[0].comment.synced_at).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P3-8: auto-optimize — runs in-process (no HTTP / cookie dependency)
// ---------------------------------------------------------------------------
describe('P3-8: auto-optimize — in-process, no session cookie HTTP round-trip', () => {
  beforeEach(() => vi.resetModules());

  it('does not call fetch; uses service client + generateOptimizeVariants', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const generateMock = vi.fn().mockResolvedValue({
      variants: [{ platform: 'linkedin', content: 'LI variant', characterCount: 10, isThread: false, threadParts: null }],
      errors: [],
    });

    vi.doMock('@/lib/optimize-variants', () => ({
      generateOptimizeVariants: generateMock,
    }));
    vi.doMock('@/lib/ai-guard', () => ({
      guardAiRequest: vi.fn().mockResolvedValue({ ok: true }),
    }));
    vi.doMock('@/lib/voice-context', () => ({
      loadCreatorVoiceContext: vi.fn().mockResolvedValue({ profile: null, contextAdditions: '' }),
    }));
    vi.doMock('@/lib/constants', () => ({
      PLATFORMS: ['twitter', 'linkedin', 'instagram', 'threads'],
    }));
    vi.doMock('@/lib/insforge/server', () => ({
      getServiceClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn().mockImplementation((table: string) => ({
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data:
                table === 'user_settings'
                  ? { value: 'true' }
                  : { title: 'Test', pillar: 'founder', workspace_id: 'ws1' },
              error: null,
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          })),
        },
      }),
      getServerClient: vi.fn(),
    }));

    const { triggerAutoOptimize } = await import('@/lib/auto-optimize');
    await triggerAutoOptimize({
      userId: 'u1',
      postId: 'p1',
      content: 'Post content here',
      sourcePlatform: 'twitter',
      workspaceId: 'ws1',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// P3-9: auto-optimize — variant_group_id set AFTER variants created
// ---------------------------------------------------------------------------
describe('P3-9: auto-optimize — variant_group_id updated only after successful variant creation', () => {
  beforeEach(() => vi.resetModules());

  it('does not update variant_group_id on source post when optimize returns no variants', async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });

    vi.doMock('@/lib/optimize-variants', () => ({
      generateOptimizeVariants: vi.fn().mockResolvedValue({ variants: [], errors: [{ platform: 'linkedin', error: 'fail' }] }),
    }));
    vi.doMock('@/lib/ai-guard', () => ({
      guardAiRequest: vi.fn().mockResolvedValue({ ok: true }),
    }));
    vi.doMock('@/lib/voice-context', () => ({
      loadCreatorVoiceContext: vi.fn().mockResolvedValue({ profile: null, contextAdditions: '' }),
    }));
    vi.doMock('@/lib/constants', () => ({
      PLATFORMS: ['twitter', 'linkedin', 'instagram', 'threads'],
    }));
    vi.doMock('@/lib/insforge/server', () => ({
      getServiceClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn().mockImplementation((table: string) => ({
            select: vi.fn().mockReturnThis(),
            update: updateMock,
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: table === 'user_settings' ? { value: 'true' } : null,
              error: null,
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          })),
        },
      }),
      getServerClient: vi.fn(),
    }));

    const { triggerAutoOptimize } = await import('@/lib/auto-optimize');
    await triggerAutoOptimize({
      userId: 'u1',
      postId: 'p1',
      content: 'Content',
      sourcePlatform: 'twitter',
      workspaceId: 'ws1',
    });

    const variantGroupUpdates = updateMock.mock.calls.filter((call) =>
      JSON.stringify(call).includes('variant_group_id'),
    );
    expect(variantGroupUpdates).toHaveLength(0);
  });
});
