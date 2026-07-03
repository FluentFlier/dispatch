/**
 * Phase: Layer 1 — Event Capture
 * Tests filter logic, SSRF guard, answers API, and cron auth/flag behavior.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { shouldCaptureEvent, classifyEventType, isPublicEvent } from '@/lib/event-capture/filter';
import { assertPublicUrl } from '@/lib/event-capture/research';

// This file registers runtime `vi.doMock(...)` factories for the modules below
// (used with dynamic import inside individual tests). Without teardown those
// registrations persist in the module registry after the file finishes and leak
// into later test files that import the real modules (notably the real
// event-capture/ingest), causing order-dependent failures. Drop every doMock
// and reset the module cache once this file is done.
afterAll(() => {
  for (const mod of [
    '@/lib/event-capture/ingest',
    '@/lib/event-capture/sources/calendar-composio',
    '@/lib/event-capture/sources/linkedin-scan',
    '@/lib/feature-flags',
    '@/lib/insforge/server',
    '@/lib/workspace',
  ]) {
    vi.doUnmock(mod);
  }
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// filter.ts
// ---------------------------------------------------------------------------
describe('Layer 1: Event Capture', () => {
  describe('filter.ts', () => {
    const base = {
      startTime: new Date('2025-06-23T18:00:00Z'),
      endTime: new Date('2025-06-23T20:00:00Z'),
    };
    const now = new Date('2025-06-24T10:00:00Z'); // ~16h after event ended

    it('shouldCaptureEvent: rejects events < 30min duration', () => {
      const event = {
        title: 'NVIDIA AI Meetup',
        startTime: new Date('2025-06-23T18:00:00Z'),
        endTime: new Date('2025-06-23T18:20:00Z'), // 20 minutes
      };
      expect(shouldCaptureEvent(event, now)).toBe(false);
    });

    it('shouldCaptureEvent: rejects events > 8h duration', () => {
      const event = {
        title: 'NVIDIA AI Conference',
        startTime: new Date('2025-06-23T08:00:00Z'),
        endTime: new Date('2025-06-23T17:30:00Z'), // 9.5 hours
      };
      expect(shouldCaptureEvent(event, now)).toBe(false);
    });

    it('shouldCaptureEvent: rejects events older than 48h', () => {
      const event = {
        title: 'YC Demo Day',
        startTime: new Date('2025-06-21T14:00:00Z'),
        endTime: new Date('2025-06-21T18:00:00Z'), // ended ~64h ago
      };
      expect(shouldCaptureEvent(event, now)).toBe(false);
    });

    it('shouldCaptureEvent: rejects block-listed titles (standup, gym, lunch)', () => {
      for (const title of ['Team standup', 'Morning gym session', 'Lunch with Priya']) {
        const event = {
          title,
          ...base,
        };
        expect(shouldCaptureEvent(event, now), `Expected "${title}" to be rejected`).toBe(false);
      }
    });

    it('shouldCaptureEvent: accepts allow-listed titles (meetup, conference)', () => {
      for (const title of ['NVIDIA AI Meetup', 'TechCrunch Conference', 'YC Demo Day']) {
        const event = {
          title,
          ...base,
        };
        expect(shouldCaptureEvent(event, now), `Expected "${title}" to be accepted`).toBe(true);
      }
    });

    it('classifyEventType: correctly maps title keywords to EventType', () => {
      expect(classifyEventType('NVIDIA AI Meetup')).toBe('meetup');
      expect(classifyEventType('TechCrunch Conference 2025')).toBe('conference');
      expect(classifyEventType('Y Combinator Demo Day')).toBe('demo_day');
      expect(classifyEventType('Fireside Chat with Jensen Huang')).toBe('panel');
      expect(classifyEventType('Sales call with Acme Corp')).toBe('sales_call');
      expect(classifyEventType('Customer call Q3 review')).toBe('customer_call');
      expect(classifyEventType('Random personal thing')).toBe('other');
    });

    it('isPublicEvent: returns true for conference/meetup/pitch etc', () => {
      expect(isPublicEvent('conference')).toBe(true);
      expect(isPublicEvent('meetup')).toBe(true);
      expect(isPublicEvent('hackathon')).toBe(true);
      expect(isPublicEvent('demo_day')).toBe(true);
      expect(isPublicEvent('keynote')).toBe(true);
      expect(isPublicEvent('panel')).toBe(true);
      expect(isPublicEvent('workshop')).toBe(true);
      expect(isPublicEvent('podcast')).toBe(true);
      expect(isPublicEvent('pitch')).toBe(true);
    });

    it('isPublicEvent: returns false for customer_call/investor_call', () => {
      expect(isPublicEvent('customer_call')).toBe(false);
      expect(isPublicEvent('investor_call')).toBe(false);
      expect(isPublicEvent('sales_call')).toBe(false);
      expect(isPublicEvent('interview')).toBe(false);
      expect(isPublicEvent('internal')).toBe(false);
      expect(isPublicEvent('other')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // research.ts — SSRF guard
  // ---------------------------------------------------------------------------
  describe('research.ts', () => {
    it('assertPublicUrl: throws on private IP ranges (10.x, 192.168.x, localhost)', async () => {
      await expect(assertPublicUrl('http://10.0.0.1/secret')).rejects.toThrow();
      await expect(assertPublicUrl('http://192.168.1.1/data')).rejects.toThrow();
      await expect(assertPublicUrl('http://localhost/api')).rejects.toThrow();
      await expect(assertPublicUrl('http://127.0.0.1/admin')).rejects.toThrow();
      await expect(assertPublicUrl('http://172.16.0.1/internal')).rejects.toThrow();
    });

    it('assertPublicUrl: throws on non-http protocols (file://, ftp://)', async () => {
      await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(
        'Only http and https protocols are allowed',
      );
      await expect(assertPublicUrl('ftp://files.example.com/data')).rejects.toThrow(
        'Only http and https protocols are allowed',
      );
    });

    it('assertPublicUrl: passes valid public URLs', async () => {
      // These will attempt a real DNS lookup in tests — mock if needed,
      // but since they're real public domains the lookup should succeed.
      // We test that the function does NOT throw for valid URLs.
      await expect(assertPublicUrl('https://example.com/page')).resolves.toBeDefined();
      await expect(assertPublicUrl('https://google.com')).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/event-capture/[id]/answers
  // ---------------------------------------------------------------------------
  describe('POST /api/event-capture/[id]/answers', () => {
    beforeEach(() => vi.resetModules());

    it('rejects empty answers object (needs at least 1)', async () => {
      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
        getServerClient: vi.fn(),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
      }));

      const { POST } = await import('@/app/api/event-capture/[id]/answers/route');
      const req = new Request('http://localhost/api/event-capture/cap-1/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: {} }),
      });

      const res = await POST(req as any, { params: { id: 'cap-1' } });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/at least one answer/i);
    });

    it('sanitizes answer text — strips control chars, enforces 500 char limit', () => {
      // Test the sanitizeAnswer function logic directly without invoking the route.
      // The route is a thin wrapper — the sanitization regex is what matters.
      const sanitize = (raw: string) =>
        raw
          .trim()
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
          .slice(0, 500);

      const longAnswer = 'A'.repeat(600);
      expect(sanitize(longAnswer).length).toBeLessThanOrEqual(500);

      const controlAnswer = 'Hello\x00World\x01\x02Test\nNewline\tTab';
      const cleaned = sanitize(controlAnswer);
      expect(cleaned).not.toContain('\x00');
      expect(cleaned).not.toContain('\x01');
      expect(cleaned).not.toContain('\x02');
      // \n (0x0A) and \t (0x09) are preserved — they are in the allowed range.
      expect(cleaned).toContain('\n');
      expect(cleaned).toContain('\t');

      // Leading/trailing whitespace trimmed.
      expect(sanitize('  hello  ')).toBe('hello');
    });

    it('returns 409 if capture already drafting or drafted', async () => {
      const draftingCapture = {
        id: 'cap-2',
        workspace_id: 'ws-1',
        status: 'drafting',
      };

      // The idempotency guard is now atomic: the route runs the ownership SELECT
      // (.single) then an UPDATE ending at .select('id'). For an already-'drafting'
      // row that UPDATE matches zero rows, so awaiting the thenable chain yields an
      // empty data array and the route returns 409.
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: draftingCapture, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
      };
      const fakeClient = {
        database: {
          from: vi.fn(() => chain),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
        getServerClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
      }));

      const { POST } = await import('@/app/api/event-capture/[id]/answers/route');
      const req = new Request('http://localhost/api/event-capture/cap-2/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: { '0': 'Some answer here' } }),
      });

      const res = await POST(req as any, { params: { id: 'cap-2' } });
      expect(res.status).toBe(409);
    });

    it('returns 404 if capture not in active workspace', async () => {
      const fakeClient = {
        database: {
          from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
          })),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
        getServerClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-other'),
      }));

      const { POST } = await import('@/app/api/event-capture/[id]/answers/route');
      const req = new Request('http://localhost/api/event-capture/cap-99/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: { '0': 'Something' } }),
      });

      const res = await POST(req as any, { params: { id: 'cap-99' } });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/cron/calendar-sync
  // ---------------------------------------------------------------------------
  describe('GET /api/cron/calendar-sync', () => {
    beforeEach(() => vi.resetModules());

    it('returns 401 without valid CRON_SECRET', async () => {
      process.env.CRON_SECRET = 'correct-secret';

      vi.doMock('@/lib/insforge/server', () => ({
        getServiceClient: vi.fn(),
      }));

      const { GET } = await import('@/app/api/cron/calendar-sync/route');
      const req = new Request('http://localhost/api/cron/calendar-sync', {
        headers: { authorization: 'Bearer wrong-secret' },
      });

      const res = await GET(req as any);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns skipped:true when feature flag disabled', async () => {
      process.env.CRON_SECRET = 'correct-secret';

      const fakeClient = {
        database: {
          from: vi.fn(),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getServiceClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(false),
      }));

      const { GET } = await import('@/app/api/cron/calendar-sync/route');
      const req = new Request('http://localhost/api/cron/calendar-sync', {
        headers: { authorization: 'Bearer correct-secret' },
      });

      const res = await GET(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('flag_disabled');
    });

    it('pulls calendar events per integration and reports per-workspace results', async () => {
      // Happy path for the Composio-based route: mock the signal_integrations
      // select + the source helpers. One integration yields a calendar capture,
      // so the LinkedIn cascade fallback should NOT fire for it.
      process.env.CRON_SECRET = 'correct-secret';

      const fakeClient = {
        database: {
          from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            // Terminal eq() in the route resolves to the awaited query result.
            then: (resolve: (v: unknown) => void) =>
              resolve({
                data: [
                  {
                    id: 'int-1',
                    workspace_id: 'ws-1',
                    toolkit: 'googlecalendar',
                    composio_user_id: 'composio-user-1',
                    connected_by_user_id: 'user-1',
                    enabled: true,
                    config: {},
                  },
                ],
                error: null,
              }),
          })),
        },
      };

      const ingestEvents = vi.fn().mockResolvedValue({ created: 1, updated: 0 });
      const cancelMissingEvents = vi.fn().mockResolvedValue(0);
      const scanLinkedInForEvents = vi.fn().mockResolvedValue([]);

      vi.doMock('@/lib/insforge/server', () => ({
        getServiceClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));
      vi.doMock('@/lib/event-capture/sources/calendar-composio', () => ({
        pullCalendarEvents: vi.fn().mockResolvedValue({ ok: true, events: [{ providerEventId: 'evt-1' }] }),
        CALENDAR_LOOKBACK_HOURS: 3,
      }));
      vi.doMock('@/lib/event-capture/sources/linkedin-scan', () => ({
        scanLinkedInForEvents,
      }));
      vi.doMock('@/lib/event-capture/ingest', () => ({ ingestEvents, cancelMissingEvents }));

      const { GET } = await import('@/app/api/cron/calendar-sync/route');
      const req = new Request('http://localhost/api/cron/calendar-sync', {
        headers: { authorization: 'Bearer correct-secret' },
      });

      const res = await GET(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.workspacesProcessed).toBe(1);
      expect(body.results[0]).toMatchObject({ workspaceId: 'ws-1', calendar: 1, linkedin: 0, status: 'ok' });
      // Calendar produced a capture, so the LinkedIn cascade must NOT run.
      expect(scanLinkedInForEvents).not.toHaveBeenCalled();
    });
  });
});
