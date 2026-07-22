/**
 * Regression tests for POST /api/voice-lab/save
 *
 * Guards the LinkedIn-import voice save flow: saving a freshly analyzed voice
 * when the user has NO creator_profile row yet must NOT trip the NOT-NULL
 * `display_name` constraint (Postgres 23502). Before the fix a blind upsert
 * inserted only the voice fields and every first-time save returned 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
}));
vi.mock('@/lib/brain/sync', () => ({
  syncBrainVoiceLab: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/supermemory', () => ({
  storePersona: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: vi.fn().mockResolvedValue('ws_active'),
}));

import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { syncBrainVoiceLab } from '@/lib/brain/sync';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { NextRequest } from 'next/server';

const mockUser = { id: 'user_123', email: 'test@example.com' };

const validBody = {
  voice_description: 'Punchy, direct, first-person.',
  voice_rules: 'No em dashes. Short sentences.',
  vocabulary_fingerprint: { top_words: ['ship', 'build'] },
  structural_patterns: { avg_sentences: 3 },
  exportable_prompt: 'Write like a builder.',
  sample_posts: [{ content: 'Shipped something today.', platform: 'linkedin' }],
};

/**
 * Builds a per-table insforge database mock. `existingProfile` controls what the
 * creator_profile lookup returns; `insertCalls`/`updateCalls` capture writes so
 * tests can assert which branch ran and with what payload.
 */
function makeClient(opts: {
  existingProfile: unknown;
  workspaceId?: string | null;
  insertCalls: unknown[][];
  updateCalls: unknown[][];
  insertError?: unknown;
  settingError?: unknown;
  creatorEqCalls?: Array<[string, unknown]>;
}) {
  const from = vi.fn((table: string) => {
    if (table === 'creator_profile') {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingProfile, error: null }),
        update: vi.fn((payload: unknown) => {
          opts.updateCalls.push([payload]);
          return {
            eq: vi.fn((column: string, value: unknown) => {
              opts.creatorEqCalls?.push([column, value]);
              return Promise.resolve({ error: null });
            }),
          };
        }),
        insert: vi.fn((rows: unknown[]) => {
          opts.insertCalls.push(rows);
          return Promise.resolve({ error: opts.insertError ?? null });
        }),
      };
      query.eq.mockImplementation((column: string, value: unknown) => {
          opts.creatorEqCalls?.push([column, value]);
          return query;
      });
      return query;
    }
    if (table === 'workspace_members') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.workspaceId ? { workspace_id: opts.workspaceId } : null,
          error: null,
        }),
      };
    }
    // user_settings - upsert is awaited without an error check.
    return { upsert: vi.fn().mockResolvedValue({ error: opts.settingError ?? null }) };
  });
  return { database: { from } };
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/voice-lab/save', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Phase: Voice Import Save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (getActiveWorkspaceId as ReturnType<typeof vi.fn>).mockResolvedValue('ws_active');
  });

  describe('First-time import (no creator_profile row)', () => {
    it('inserts a new row seeding display_name instead of returning 500', async () => {
      (getActiveWorkspaceId as ReturnType<typeof vi.fn>).mockResolvedValue('ws_9');
      const insertCalls: unknown[][] = [];
      const updateCalls: unknown[][] = [];
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(
        makeClient({ existingProfile: null, workspaceId: 'ws_9', insertCalls, updateCalls }),
      );

      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(200);
      expect(insertCalls).toHaveLength(1);
      expect(updateCalls).toHaveLength(0);
      const inserted = insertCalls[0][0] as Record<string, unknown>;
      // Regression: display_name must be present and non-null on insert.
      expect(inserted.display_name).toBe('Creator');
      expect(inserted.display_name).not.toBeNull();
      expect(inserted.voice_description).toBe(validBody.voice_description);
      expect(inserted.workspace_id).toBe('ws_9');
    });

    it('falls back to "Creator" when the account has no email', async () => {
      (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'user_123', email: '' });
      const insertCalls: unknown[][] = [];
      const updateCalls: unknown[][] = [];
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(
        makeClient({ existingProfile: null, insertCalls, updateCalls }),
      );

      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(200);
      expect((insertCalls[0][0] as Record<string, unknown>).display_name).toBe('Creator');
    });

    it('returns 500 when the insert itself fails', async () => {
      const insertCalls: unknown[][] = [];
      const updateCalls: unknown[][] = [];
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(
        makeClient({
          existingProfile: null,
          insertCalls,
          updateCalls,
          insertError: { code: '23502', message: 'boom' },
        }),
      );

      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(500);
    });
  });

  describe('Existing profile', () => {
    it('updates voice fields only and never clobbers display_name', async () => {
      const insertCalls: unknown[][] = [];
      const updateCalls: unknown[][] = [];
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(
        makeClient({ existingProfile: { id: 'p1', workspace_id: 'ws_1' }, insertCalls, updateCalls }),
      );

      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(200);
      expect(updateCalls).toHaveLength(1);
      expect(insertCalls).toHaveLength(0);
      const updated = updateCalls[0][0] as Record<string, unknown>;
      expect(updated).not.toHaveProperty('display_name');
      expect(updated.voice_description).toBe(validBody.voice_description);
    });

    it('finds and updates the canonical user profile after switching workspaces', async () => {
      const insertCalls: unknown[][] = [];
      const updateCalls: unknown[][] = [];
      const creatorEqCalls: Array<[string, unknown]> = [];
      const client = makeClient({
        existingProfile: { id: 'p1', workspace_id: 'ws_original' },
        insertCalls,
        updateCalls,
        creatorEqCalls,
      });
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(200);
      expect(updateCalls).toHaveLength(1);
      expect(insertCalls).toHaveLength(0);
      expect(creatorEqCalls).toEqual([
        ['user_id', 'user_123'],
        ['user_id', 'user_123'],
      ]);
    });

    it('does not sync derived Brain state when a canonical setting fails to save', async () => {
      const insertCalls: unknown[][] = [];
      const updateCalls: unknown[][] = [];
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(
        makeClient({ existingProfile: { id: 'p1' }, insertCalls, updateCalls, settingError: { message: 'db down' } }),
      );
      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(500);
      expect(syncBrainVoiceLab).not.toHaveBeenCalled();
    });
  });

  describe('Saved voice load', () => {
    it('loads the canonical user profile while keeping rich settings workspace-scoped', async () => {
      const eqCalls: Record<string, Array<[string, unknown]>> = {
        creator_profile: [],
        user_settings: [],
      };
      const from = vi.fn((table: string) => {
        if (table === 'creator_profile') {
          const query = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((column: string, value: unknown) => {
              eqCalls.creator_profile.push([column, value]);
              return query;
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { voice_description: 'Direct', voice_rules: 'Be concise' },
              error: null,
            }),
          };
          return query;
        }
        const settingsResult = {
          data: [{ key: 'persona_prompt_export', value: 'Write directly.' }],
          error: null,
        };
        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((column: string, value: unknown) => {
            eqCalls.user_settings.push([column, value]);
            return query;
          }),
          in: vi.fn().mockReturnThis(),
          then: (resolve: (value: typeof settingsResult) => unknown) => Promise.resolve(settingsResult).then(resolve),
        };
        return query;
      });
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ database: { from } });

      const { GET } = await import('@/app/api/voice-lab/save/route');
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.persona.voice_description).toBe('Direct');
      expect(eqCalls.creator_profile).toEqual([['user_id', 'user_123']]);
      expect(eqCalls.user_settings).toEqual([
        ['user_id', 'user_123'],
        ['workspace_id', 'ws_active'],
      ]);
    });
  });

  describe('Auth + validation', () => {
    it('returns 401 when not authenticated', async () => {
      (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(401);
    });

    it('returns 400 for an invalid body', async () => {
      (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(
        makeClient({ existingProfile: null, insertCalls: [], updateCalls: [] }),
      );
      const { POST } = await import('@/app/api/voice-lab/save/route');
      const res = await POST(makeRequest({ voice_description: 123 }));
      expect(res.status).toBe(400);
    });
  });
});
