/**
 * Phase: Workspace Migration regression tests.
 * Verifies workspace scoping is applied correctly across API routes and lib.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Schema: workspaces + workspace_members exist in schema.sql
// ---------------------------------------------------------------------------
describe('schema.sql — workspace tables present', () => {
  it('contains CREATE TABLE workspaces', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8');
    expect(sql).toContain('create table if not exists workspaces');
    expect(sql).toContain('create table if not exists workspace_members');
  });

  it('has ALTER TABLE ... ADD COLUMN workspace_id for all 12 content tables', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8');
    const tables = [
      'creator_profile', 'posts', 'series', 'story_bank', 'content_ideas',
      'hashtag_sets', 'weekly_reviews', 'user_settings', 'social_accounts',
      'publish_jobs', 'ayrshare_profiles', 'creator_brain_pages',
    ];
    for (const table of tables) {
      expect(sql).toContain(`alter table ${table}`);
      expect(sql).toContain(`add column if not exists workspace_id`);
    }
  });
});

// ---------------------------------------------------------------------------
// workspace.ts — listWorkspaces filters at DB level
// ---------------------------------------------------------------------------
describe('listWorkspaces — DB-level .in() filter', () => {
  beforeEach(() => vi.resetModules());

  it('uses .in() to scope workspace query', async () => {
    const inMock = vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'ws-1', name: 'My workspace', type: 'solo', owner_user_id: 'user-1' }],
        error: null,
      }),
    });

    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'workspace_members') {
              // Return one membership so listWorkspaces proceeds to query workspaces
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({
                  data: [{ workspace_id: 'ws-1', role: 'owner' }],
                  error: null,
                }),
              };
            }
            // workspaces table — this is where .in() gets called
            return {
              select: vi.fn().mockReturnThis(),
              in: inMock,
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }),
        },
      }),
    }));
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }),
    }));
    vi.doMock('@/lib/entitlements', () => ({ getUserEntitlements: vi.fn() }));

    const { listWorkspaces } = await import('@/lib/workspace');
    await listWorkspaces('user-1');

    expect(inMock).toHaveBeenCalledWith('id', expect.arrayContaining(['ws-1']));
  });
});

// ---------------------------------------------------------------------------
// workspace.ts — ensureSoloWorkspace creates workspace for new user
// ---------------------------------------------------------------------------
describe('ensureSoloWorkspace — creates solo workspace on first call', () => {
  beforeEach(() => vi.resetModules());

  it('inserts workspace + member rows when user has none', async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'ws-new', name: 'My workspace', type: 'solo', owner_user_id: 'u1' }, error: null }),
      }),
    });
    const memberInsertMock = vi.fn().mockResolvedValue({ error: null });

    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'workspace_members') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [], error: null }), // no existing membership
                insert: memberInsertMock,
              };
            }
            if (table === 'workspaces') {
              return { insert: insertMock };
            }
            return {};
          }),
        },
      }),
      getServiceClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'workspace_members') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                insert: memberInsertMock,
              };
            }
            if (table === 'workspaces') {
              return { insert: insertMock };
            }
            return {};
          }),
        },
      }),
    }));
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }),
    }));
    vi.doMock('@/lib/entitlements', () => ({ getUserEntitlements: vi.fn() }));

    const { ensureSoloWorkspace } = await import('@/lib/workspace');
    const ws = await ensureSoloWorkspace('u1');

    expect(ws.id).toBe('ws-new');
    expect(ws.type).toBe('solo');
    expect(memberInsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'owner', user_id: 'u1' })])
    );
  });
});

// ---------------------------------------------------------------------------
// voice-context.ts — workspaceId threads through profile query
// ---------------------------------------------------------------------------
describe('loadCreatorVoiceContext — workspace scoping', () => {
  beforeEach(() => vi.resetModules());

  it('calls .eq("workspace_id", ...) when workspaceId provided', async () => {
    const eqMock = vi.fn().mockReturnThis();
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });

    const fakeClient = {
      database: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: eqMock,
          in: vi.fn().mockReturnThis(),
          maybeSingle: maybeSingleMock,
        }),
      },
    };

    vi.doMock('@/lib/brain/retrieve', () => ({
      retrieveBrainContext: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('@/lib/supermemory', () => ({
      searchUserContext: vi.fn().mockResolvedValue([]),
    }));

    const { loadCreatorVoiceContext } = await import('@/lib/voice-context');
    await loadCreatorVoiceContext(fakeClient as never, 'user-1', {
      workspaceId: 'ws-123',
    });

    // eq must have been called with workspace_id
    expect(eqMock).toHaveBeenCalledWith('workspace_id', 'ws-123');
  });

  it('does NOT call .eq("workspace_id") when workspaceId is undefined', async () => {
    const eqMock = vi.fn().mockReturnThis();

    const fakeClient = {
      database: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: eqMock,
          in: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      },
    };

    vi.doMock('@/lib/brain/retrieve', () => ({
      retrieveBrainContext: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('@/lib/supermemory', () => ({
      searchUserContext: vi.fn().mockResolvedValue([]),
    }));

    const { loadCreatorVoiceContext } = await import('@/lib/voice-context');
    await loadCreatorVoiceContext(fakeClient as never, 'user-1', {});

    // Must not filter by workspace_id when not provided
    const workspaceEqCalls = eqMock.mock.calls.filter(
      (call) => call[0] === 'workspace_id'
    );
    expect(workspaceEqCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// migrate-workspaces.ts — backfill script exists and has correct structure
// ---------------------------------------------------------------------------
describe('migrate-workspaces.ts — backfill script', () => {
  it('script file exists in scripts/', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const exists = fs.existsSync(path.resolve(__dirname, '../scripts/migrate-workspaces.ts'));
    expect(exists).toBe(true);
  });

  it('script references all 12 content tables', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-workspaces.ts'), 'utf8');
    const tables = [
      'posts', 'series', 'story_bank', 'content_ideas', 'hashtag_sets',
      'weekly_reviews', 'user_settings', 'social_accounts', 'publish_jobs',
      'ayrshare_profiles', 'creator_brain_pages', 'creator_profile',
    ];
    for (const t of tables) {
      expect(src).toContain(`'${t}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// auth route — ensureSoloWorkspace called on login
// ---------------------------------------------------------------------------
describe('auth route — workspace provisioned on login', () => {
  it('establishAuthenticatedSession calls ensureSoloWorkspace', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../src/lib/auth-establish.ts'), 'utf8');
    expect(src).toContain('ensureSoloWorkspace');
    expect(src).toContain('workspace_provision_failed');
  });
});
