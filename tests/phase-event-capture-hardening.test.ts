import { describe, it, expect, vi, afterEach } from 'vitest';

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
});
