import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Phase: Loop readiness', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('GET /api/loop/readiness returns steps for incomplete engage loop', async () => {
    vi.doMock('@/lib/insforge/server', () => ({
      getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      getServerClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn((table: string) => {
            if (table === 'social_accounts') {
              return {
                select: () => ({
                  eq: () => Promise.resolve({ data: [], error: null }),
                }),
              };
            }
            if (table === 'posts') {
              // Published posts are counted as status='posted' AND posted_date
              // NOT NULL, so the chain ends on .not().
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      not: () => Promise.resolve({ count: 0, error: null }),
                    }),
                  }),
                }),
              };
            }
            return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
          }),
        },
      }),
    }));

    vi.doMock('@/lib/workspace', () => ({
      getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
    }));

    vi.doMock('@/lib/brain/pages', () => ({
      getBrainStatus: vi.fn().mockResolvedValue({ page_count: 0, slugs: [], last_updated: null }),
    }));

    vi.doMock('@/lib/signals/safety/guard', () => ({
      getSafetyStatus: vi.fn().mockResolvedValue({
        settings: { outreach_enabled: false, dry_run: true },
      }),
    }));

    const { GET } = await import('@/app/api/loop/readiness/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.complete).toBe(false);
    expect(body.steps).toHaveLength(4);
    expect(body.steps.map((s: { id: string }) => s.id)).toEqual([
      'linkedin',
      'brain',
      'publish',
      'outreach',
    ]);
  });
});
