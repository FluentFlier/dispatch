/**
 * Phase: Event Capture Inbox Fixes
 *
 * Covers three bugs reported against the event-capture inbox:
 *  1. enrichCapture left a capture stuck at status='researching' forever if
 *     question generation threw — a status the inbox GET route doesn't select,
 *     so the capture silently vanished with no way to retry.
 *  2. /regenerate-questions cleared stored answers BEFORE attempting
 *     enrichment, so a failed/blocked reload destroyed answers the user had
 *     already given for nothing.
 *  3. /regenerate-draft hard-required already-stored answers with no way to
 *     provide them, even though the zero-post 'drafted' state (e.g. reached via
 *     /auto-draft, which stores answers={}) has no other path back into Q&A.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/insforge/server');
  vi.doUnmock('@/lib/workspace');
  vi.doUnmock('@/lib/event-capture/enrich');
  vi.doUnmock('@/lib/ai-budget');
  vi.doUnmock('@/lib/event-capture/questions');
  vi.doUnmock('@/lib/event-capture/research');
});

describe('enrichCapture: reverts status on failure instead of stranding at "researching"', () => {
  const NOW = new Date('2026-07-02T12:00:00Z');
  const CAPTURE = {
    id: 'cap-1', workspace_id: 'ws-1', user_id: 'u-1', status: 'drafted',
    title: 'Old Meetup', location: null,
    start_time: '2026-06-01T17:00:00Z', end_time: '2026-06-01T18:00:00Z',
    event_type: 'other', is_public_event: false,
  };

  it('reverts to the original status and rethrows when question generation fails', async () => {
    const updates: Array<Record<string, unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      database: {
        from: (table: string) => {
          if (table === 'event_captures') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const q: any = {};
            q.select = () => q;
            q.eq = () => q;
            q.single = () => ({ data: CAPTURE, error: null });
            q.update = (patch: Record<string, unknown>) => ({
              eq: () => { updates.push(patch); return Promise.resolve({ error: null }); },
            });
            return q;
          }
          if (table === 'creator_profile') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const q: any = {};
            q.select = () => q;
            q.eq = () => q;
            q.maybeSingle = () => ({ data: null, error: null });
            return q;
          }
          throw new Error(`unexpected table ${table}`);
        },
      },
    };

    vi.doMock('@/lib/ai-budget', () => ({ checkAndIncrementUsage: vi.fn().mockResolvedValue('ok') }));
    vi.doMock('@/lib/event-capture/questions', () => ({
      generateEventQuestions: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    }));
    vi.doMock('@/lib/event-capture/research', () => ({
      researchPublicEvent: vi.fn(), researchCacheKey: vi.fn(),
      getCachedResearch: vi.fn(), putCachedResearch: vi.fn(),
    }));

    const { enrichCapture } = await import('@/lib/event-capture/enrich');
    await expect(enrichCapture(client, 'cap-1', NOW, { ignoreRecency: true })).rejects.toThrow('LLM timeout');

    // First update flips to 'researching'; the revert update on failure must
    // restore the capture's original status ('drafted' here) rather than
    // leaving it at 'researching', which the inbox GET route never selects.
    expect(updates[0].status).toBe('researching');
    expect(updates[updates.length - 1].status).toBe('drafted');
  });
});

describe('POST /api/event-capture/[id]/regenerate-questions', () => {
  const authMocks = () => {
    vi.doMock('@/lib/insforge/server', () => ({
      getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      getServerClient: vi.fn(),
    }));
    vi.doMock('@/lib/workspace', () => ({ getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1') }));
  };

  it('does not clear stored answers when enrichment fails to reach questions_ready', async () => {
    authMocks();
    const answersUpdateCalls: Array<Record<string, unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      database: {
        from: () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {};
          q.select = () => q;
          q.eq = () => q;
          q.single = () => ({ data: { id: 'cap-1', workspace_id: 'ws-1' }, error: null });
          q.update = (patch: Record<string, unknown>) => ({
            eq: () => ({ eq: () => { answersUpdateCalls.push(patch); return Promise.resolve({ error: null }); } }),
          });
          return q;
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insforgeMod = (await import('@/lib/insforge/server')) as any;
    insforgeMod.getServerClient.mockReturnValue(client);

    vi.doMock('@/lib/event-capture/enrich', () => ({
      enrichCapture: vi.fn().mockResolvedValue('budget_blocked'),
    }));

    const { POST } = await import('@/app/api/event-capture/[id]/regenerate-questions/route');
    const req = new Request('http://localhost/api/event-capture/cap-1/regenerate-questions', { method: 'POST' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: { id: 'cap-1' } });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('budget_blocked');
    // The answers-clearing update must never fire when enrichment didn't succeed.
    expect(answersUpdateCalls).toHaveLength(0);
  });

  it('clears stored answers once enrichment succeeds', async () => {
    authMocks();
    const answersUpdateCalls: Array<Record<string, unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      database: {
        from: () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {};
          q.select = () => q;
          q.eq = () => q;
          q.single = () => ({ data: { id: 'cap-1', workspace_id: 'ws-1' }, error: null });
          q.update = (patch: Record<string, unknown>) => ({
            eq: () => ({ eq: () => { answersUpdateCalls.push(patch); return Promise.resolve({ error: null }); } }),
          });
          return q;
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insforgeMod = (await import('@/lib/insforge/server')) as any;
    insforgeMod.getServerClient.mockReturnValue(client);

    vi.doMock('@/lib/event-capture/enrich', () => ({
      enrichCapture: vi.fn().mockResolvedValue('questions_ready'),
    }));

    const { POST } = await import('@/app/api/event-capture/[id]/regenerate-questions/route');
    const req = new Request('http://localhost/api/event-capture/cap-1/regenerate-questions', { method: 'POST' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: { id: 'cap-1' } });

    expect(res.status).toBe(200);
    expect(answersUpdateCalls).toHaveLength(1);
    expect(answersUpdateCalls[0].answers).toEqual({});
  });
});

describe('POST /api/event-capture/[id]/regenerate-draft', () => {
  const authMocks = () => {
    vi.doMock('@/lib/insforge/server', () => ({
      getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      getServerClient: vi.fn(),
    }));
    vi.doMock('@/lib/workspace', () => ({ getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1') }));
  };

  function buildClient(storedAnswers: Record<string, string> | null) {
    const captureUpdateCalls: Array<Record<string, unknown>> = [];
    const postsDeleteCalls: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      database: {
        from: (table: string) => {
          if (table === 'event_captures') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const q: any = {};
            q.select = () => q;
            q.eq = () => q;
            q.single = () => ({ data: { id: 'cap-1', workspace_id: 'ws-1', answers: storedAnswers }, error: null });
            q.update = (patch: Record<string, unknown>) => ({
              eq: () => ({ eq: () => { captureUpdateCalls.push(patch); return Promise.resolve({ error: null }); } }),
            });
            return q;
          }
          if (table === 'posts') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const q: any = {};
            q.delete = () => q;
            q.eq = () => ({ eq: () => { postsDeleteCalls.push(1); return Promise.resolve({ error: null }); } });
            return q;
          }
          throw new Error(`unexpected table ${table}`);
        },
      },
    };
    return { client, captureUpdateCalls, postsDeleteCalls };
  }

  it('422s when there are no stored answers and none are provided', async () => {
    authMocks();
    const { client } = buildClient(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insforgeMod = (await import('@/lib/insforge/server')) as any;
    insforgeMod.getServerClient.mockReturnValue(client);

    const { POST } = await import('@/app/api/event-capture/[id]/regenerate-draft/route');
    const req = new Request('http://localhost/api/event-capture/cap-1/regenerate-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: { id: 'cap-1' } });

    expect(res.status).toBe(422);
  });

  it('persists answers provided in the body and proceeds (the auto-draft zero-post recovery path)', async () => {
    authMocks();
    const { client, captureUpdateCalls, postsDeleteCalls } = buildClient({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insforgeMod = (await import('@/lib/insforge/server')) as any;
    insforgeMod.getServerClient.mockReturnValue(client);

    process.env.CRON_SECRET = 'secret';
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    const { POST } = await import('@/app/api/event-capture/[id]/regenerate-draft/route');
    const req = new Request('http://localhost/api/event-capture/cap-1/regenerate-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { '0': 'Met three founders' } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: { id: 'cap-1' } });

    expect(res.status).toBe(202);
    expect(postsDeleteCalls.length).toBeGreaterThan(0);
    const answerUpdate = captureUpdateCalls.find((p) => 'answers' in p);
    expect(answerUpdate?.answers).toEqual({ '0': 'Met three founders' });
    expect(captureUpdateCalls.some((p) => p.status === 'drafting')).toBe(true);

    global.fetch = originalFetch;
  });

  it('falls back to already-stored answers when no body answers are provided', async () => {
    authMocks();
    const { client, captureUpdateCalls } = buildClient({ '0': 'Previously answered' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insforgeMod = (await import('@/lib/insforge/server')) as any;
    insforgeMod.getServerClient.mockReturnValue(client);

    process.env.CRON_SECRET = 'secret';
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    const { POST } = await import('@/app/api/event-capture/[id]/regenerate-draft/route');
    const req = new Request('http://localhost/api/event-capture/cap-1/regenerate-draft', { method: 'POST' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: { id: 'cap-1' } });

    expect(res.status).toBe(202);
    // No body answers were sent, so the answers column is never rewritten.
    expect(captureUpdateCalls.some((p) => 'answers' in p)).toBe(false);

    global.fetch = originalFetch;
  });
});
