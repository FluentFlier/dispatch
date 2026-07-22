import { describe, it, expect, vi, afterEach } from 'vitest';
import { filterUnscannedPosts } from '@/lib/event-capture/sources/linkedin-scan';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/insforge/server');
  vi.doUnmock('@/lib/workspace');
});

describe('Phase: Event Capture Hardening', () => {
  describe('Task 1: POST /api/event-capture/trigger uses service client for jobs writes', () => {
    it('inserts jobs via the service client, not the user client', async () => {
      const userClientInsertJobs = vi.fn();
      const serviceClientInsertJobs = vi.fn().mockResolvedValue({ error: null });

      const userClient = {
        database: {
          from: vi.fn((table: string) => {
            if (table === 'event_captures') {
              // Minimal mock query-builder chain: typed as a map of vi.fn() mocks
              // (rather than `any`) since `select`/`eq` are assigned after the
              // object is created to allow the self-referential `.mockReturnValue(chain)`.
              const chain: Record<string, ReturnType<typeof vi.fn>> = {};
              chain.select = vi.fn().mockReturnValue(chain);
              chain.eq = vi.fn()
                .mockReturnValueOnce(chain) // .eq('workspace_id', ...)
                .mockResolvedValueOnce({ data: [{ id: 'cap-1', workspace_id: 'ws-1' }], error: null }); // .eq('status','detected')
              return chain;
            }
            if (table === 'jobs') {
              return { insert: userClientInsertJobs };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      };

      const serviceClient = {
        database: {
          from: vi.fn((table: string) => {
            if (table === 'jobs') return { insert: serviceClientInsertJobs };
            throw new Error(`unexpected table ${table}`);
          }),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
        getServerClient: vi.fn().mockReturnValue(userClient),
        getServiceClient: vi.fn().mockReturnValue(serviceClient),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
      }));

      const { POST } = await import('@/app/api/event-capture/trigger/route');
      const req = new Request('http://localhost/api/event-capture/trigger', { method: 'POST' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await POST(req as any);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, enqueued: 1 });
      expect(userClientInsertJobs).not.toHaveBeenCalled();
      expect(serviceClientInsertJobs).toHaveBeenCalledTimes(1);
    });

    it('returns 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue(null),
        getServerClient: vi.fn(),
        getServiceClient: vi.fn(),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn(),
      }));

      const { POST } = await import('@/app/api/event-capture/trigger/route');
      const req = new Request('http://localhost/api/event-capture/trigger', { method: 'POST' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await POST(req as any);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when user has no active workspace', async () => {
      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
        getServerClient: vi.fn(),
        getServiceClient: vi.fn(),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue(null),
      }));

      const { POST } = await import('@/app/api/event-capture/trigger/route');
      const req = new Request('http://localhost/api/event-capture/trigger', { method: 'POST' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await POST(req as any);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: 'No active workspace' });
    });
  });

  describe('Task 2: LinkedIn scan cost control', () => {
    describe('filterUnscannedPosts', () => {
      it('drops posts whose id is already in the scanned set', () => {
        const items = [{ id: 'p1', text: 'a' }, { id: 'p2', text: 'b' }, { id: 'p3', text: 'c' }];
        const scanned = new Set(['p1', 'p3']);
        expect(filterUnscannedPosts(items, scanned)).toEqual([{ id: 'p2', text: 'b' }]);
      });

      it('keeps all posts when nothing has been scanned yet', () => {
        const items = [{ id: 'p1' }, { id: 'p2' }];
        expect(filterUnscannedPosts(items, new Set())).toHaveLength(2);
      });
    });

    describe('scanLinkedInForEvents budget gate', () => {
      afterEach(() => {
        vi.resetModules();
        vi.doUnmock('@/lib/ai');
        vi.doUnmock('@/lib/ai-budget');
        vi.doUnmock('@/lib/ai-tiers');
        vi.doUnmock('@/lib/social/unipile');
      });

      it('stops classifying once the haiku budget is blocked, without dropping already-found events', async () => {
        const generateContent = vi.fn()
          .mockResolvedValueOnce('{"isFutureEvent":true,"title":"AI Summit","date":"2026-08-01","location":"SF"}')
          .mockResolvedValueOnce('{"isFutureEvent":false}');
        vi.doMock('@/lib/ai', () => ({ generateContent }));
        vi.doMock('@/lib/ai-tiers', () => ({ resolveModel: vi.fn().mockReturnValue('haiku-fast') }));

        // Budget is checked before each classification and the loop breaks on
        // 'blocked': p1 and p2 classify (ok, ok), p3 is blocked before its LLM call.
        const checkAndIncrementUsage = vi.fn()
          .mockResolvedValueOnce('ok')
          .mockResolvedValueOnce('ok')
          .mockResolvedValueOnce('blocked');
        vi.doMock('@/lib/ai-budget', () => ({ checkAndIncrementUsage }));

        vi.doMock('@/lib/social/unipile', () => ({
          fetchUnipileAccountDetails: vi.fn().mockResolvedValue({
            id: 'ua1',
            type: 'LINKEDIN',
            connection_params: { im: { memberId: 'a1' } },
          }),
          listUnipileAccounts: vi.fn().mockResolvedValue([]),
          unipoleFetch: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
              items: [
                { id: 'p1', text: 'Excited to speak at AI Summit in August, this is going to be a great professional event!' },
                { id: 'p2', text: 'Another post about attending a totally different future conference next month too.' },
                { id: 'p3', text: 'A third post that should never be reached because budget blocks after the second call.' },
              ],
            }),
          }),
        }));

        const stateRow = { scanned_post_ids: [] as string[] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fakeClient: any = {
          database: {
            from: vi.fn((table: string) => {
              if (table === 'social_accounts') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const chain: any = {};
                chain.select = vi.fn().mockReturnValue(chain);
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.not = vi.fn().mockReturnValue(chain);
                chain.maybeSingle = vi.fn().mockResolvedValue({ data: { unipile_account_id: 'ua1', account_id: 'a1' } });
                return chain;
              }
              if (table === 'linkedin_scan_state') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const chain: any = {};
                chain.select = vi.fn().mockReturnValue(chain);
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.maybeSingle = vi.fn().mockResolvedValue({ data: stateRow });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                chain.upsert = vi.fn().mockImplementation((row: any) => {
                  stateRow.scanned_post_ids = row.scanned_post_ids;
                  return Promise.resolve({ error: null });
                });
                return chain;
              }
              throw new Error(`unexpected table ${table}`);
            }),
          },
        };

        const { scanLinkedInForEvents } = await import('@/lib/event-capture/sources/linkedin-scan');
        const events = await scanLinkedInForEvents(fakeClient, { workspaceId: 'ws-1', userId: 'u1' }, new Date('2026-07-02T12:00:00Z'));

        expect(generateContent).toHaveBeenCalledTimes(2); // p3 never classified, budget blocked after p2
        expect(events).toHaveLength(1);
        expect(events[0].title).toBe('AI Summit');
        expect(checkAndIncrementUsage).toHaveBeenCalledWith(fakeClient, 'ws-1', 'haiku');
        // p1 and p2 both got recorded as scanned even though only p1 was a real event.
        expect(stateRow.scanned_post_ids).toEqual(expect.arrayContaining(['p1', 'p2']));
        expect(stateRow.scanned_post_ids).not.toContain('p3');
      });
    });
  });

  describe('Task 3: event-enrich cron reclaims stuck processing jobs', () => {
    afterEach(() => {
      vi.resetModules();
      vi.doUnmock('@/lib/insforge/server');
      vi.doUnmock('@/lib/feature-flags');
    });

    it('requeues a job stuck in processing past the timeout, incrementing attempts', async () => {
      process.env.CRON_SECRET = 'correct-secret';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const staleJob: any = { id: 'job-stale', attempts: 1, max_attempts: 3, status: 'processing' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobsTable: any[] = [staleJob];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeClient: any = {
        database: {
          from: vi.fn((table: string) => {
            if (table !== 'jobs') throw new Error(`unexpected table ${table}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chain: any = { _filters: {} as Record<string, unknown> };
            chain.select = vi.fn().mockReturnValue(chain);
            chain.eq = vi.fn((col: string, val: unknown) => { chain._filters[col] = val; return chain; });
            chain.lt = vi.fn().mockReturnValue(chain);
            chain.order = vi.fn().mockReturnValue(chain);
            chain.limit = vi.fn().mockResolvedValue({
              data: chain._filters.status === 'processing' ? jobsTable : [],
              error: null,
            });
            // The real InsForge builder is thenable: awaiting it (as the reclaim
            // query does, ending at .lt with no .limit) runs the query. The claim
            // query resolves via .limit() above instead.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chain.then = (resolve: (v: any) => void) =>
              resolve({ data: chain._filters.status === 'processing' ? jobsTable : [], error: null });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chain.update = vi.fn((patch: any) => ({
              eq: vi.fn((col: string, val: unknown) => {
                const row = jobsTable.find((j) => j[col] === val);
                if (row) Object.assign(row, patch);
                return Promise.resolve({ error: null });
              }),
              in: vi.fn().mockResolvedValue({ error: null }),
            }));
            return chain;
          }),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({ getServiceClient: vi.fn().mockReturnValue(fakeClient) }));
      vi.doMock('@/lib/feature-flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));

      const { GET } = await import('@/app/api/cron/event-enrich/route');
      const req = new Request('http://localhost/api/cron/event-enrich', {
        headers: { authorization: 'Bearer correct-secret' },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await GET(req as any);

      expect(staleJob.status).toBe('pending');
      expect(staleJob.attempts).toBe(2);
    });

    it('fails a stuck job that reaches max_attempts instead of reclaiming it forever', async () => {
      process.env.CRON_SECRET = 'correct-secret';

      // attempts 2 + 1 = 3 = max_attempts, so this reclaim must terminate it as 'failed'.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const staleJob: any = { id: 'job-poison', attempts: 2, max_attempts: 3, status: 'processing' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobsTable: any[] = [staleJob];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeClient: any = {
        database: {
          from: vi.fn((table: string) => {
            if (table !== 'jobs') throw new Error(`unexpected table ${table}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chain: any = { _filters: {} as Record<string, unknown> };
            chain.select = vi.fn().mockReturnValue(chain);
            chain.eq = vi.fn((col: string, val: unknown) => { chain._filters[col] = val; return chain; });
            chain.lt = vi.fn().mockReturnValue(chain);
            chain.order = vi.fn().mockReturnValue(chain);
            chain.limit = vi.fn().mockResolvedValue({
              data: chain._filters.status === 'processing' ? jobsTable : [],
              error: null,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chain.then = (resolve: (v: any) => void) =>
              resolve({ data: chain._filters.status === 'processing' ? jobsTable : [], error: null });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chain.update = vi.fn((patch: any) => ({
              eq: vi.fn((col: string, val: unknown) => {
                const row = jobsTable.find((j) => j[col] === val);
                if (row) Object.assign(row, patch);
                return Promise.resolve({ error: null });
              }),
              in: vi.fn().mockResolvedValue({ error: null }),
            }));
            return chain;
          }),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({ getServiceClient: vi.fn().mockReturnValue(fakeClient) }));
      vi.doMock('@/lib/feature-flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));

      const { GET } = await import('@/app/api/cron/event-enrich/route');
      const req = new Request('http://localhost/api/cron/event-enrich', {
        headers: { authorization: 'Bearer correct-secret' },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await GET(req as any);

      expect(staleJob.status).toBe('failed');
      expect(staleJob.attempts).toBe(3);
    });
  });

  describe('Task 4: /answers atomic idempotency guard', () => {
    afterEach(() => {
      vi.resetModules();
      vi.doUnmock('@/lib/insforge/server');
      vi.doUnmock('@/lib/workspace');
    });

    it('returns 409 on the second of two concurrent submissions for the same capture', async () => {
      const captureRow = { id: 'cap-1', workspace_id: 'ws-1', status: 'questions_ready' };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeClient: any = {
        database: {
          from: vi.fn(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chain: any = { _filters: {} as Record<string, unknown> };
            chain.select = vi.fn().mockReturnValue(chain);
            chain.eq = vi.fn((col: string, val: unknown) => { chain._filters[col] = val; return chain; });
            chain.neq = vi.fn().mockReturnValue(chain);
            chain.single = vi.fn().mockResolvedValue({ data: captureRow, error: null });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chain.update = vi.fn((patch: any) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const updateChain: any = {};
              updateChain.eq = vi.fn().mockReturnValue(updateChain);
              updateChain.neq = vi.fn().mockReturnValue(updateChain);
              updateChain.select = vi.fn().mockImplementation(() => {
                // Simulate the DB row transition: the first call to reach here sees
                // the status still eligible and wins; once it flips the row to
                // 'drafting', the second concurrent call sees zero rows affected.
                if (captureRow.status === 'drafting' || captureRow.status === 'drafted') {
                  return Promise.resolve({ data: [], error: null });
                }
                captureRow.status = patch.status;
                return Promise.resolve({ data: [{ id: captureRow.id }], error: null });
              });
              return updateChain;
            });
            return chain;
          }),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
        getServerClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/workspace', () => ({ getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1') }));

      const { POST } = await import('@/app/api/event-capture/[id]/answers/route');
      const makeReq = () => new Request('http://localhost/api/event-capture/cap-1/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: { '0': 'Great talk on scaling.' } }),
      });

      const [first, second] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        POST(makeReq() as any, { params: { id: 'cap-1' } }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        POST(makeReq() as any, { params: { id: 'cap-1' } }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([202, 409]);
    });

    it('auto-draft returns 409 on the second of two concurrent calls for the same capture', async () => {
      const captureRow = { id: 'cap-1', workspace_id: 'ws-1', status: 'questions_ready' };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeClient: any = {
        database: {
          from: vi.fn(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chain: any = {};
            chain.select = vi.fn().mockReturnValue(chain);
            chain.eq = vi.fn().mockReturnValue(chain);
            chain.neq = vi.fn().mockReturnValue(chain);
            chain.single = vi.fn().mockResolvedValue({ data: captureRow, error: null });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chain.update = vi.fn((patch: any) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const updateChain: any = {};
              updateChain.eq = vi.fn().mockReturnValue(updateChain);
              updateChain.neq = vi.fn().mockReturnValue(updateChain);
              updateChain.select = vi.fn().mockImplementation(() => {
                if (captureRow.status === 'drafting' || captureRow.status === 'drafted') {
                  return Promise.resolve({ data: [], error: null });
                }
                captureRow.status = patch.status;
                return Promise.resolve({ data: [{ id: captureRow.id }], error: null });
              });
              return updateChain;
            });
            return chain;
          }),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
        getServerClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/workspace', () => ({ getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1') }));

      const { POST } = await import('@/app/api/event-capture/[id]/auto-draft/route');
      const makeReq = () => new Request('http://localhost/api/event-capture/cap-1/auto-draft', { method: 'POST' });

      const [first, second] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        POST(makeReq() as any, { params: { id: 'cap-1' } }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        POST(makeReq() as any, { params: { id: 'cap-1' } }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([202, 409]);
    });
  });
});
