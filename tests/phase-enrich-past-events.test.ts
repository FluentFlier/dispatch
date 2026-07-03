/**
 * Phase: Enrich Past Events (manual reload)
 *
 * Verifies the ignoreRecency escape hatch on enrichCapture: the hourly cron keeps
 * skipping events older than 48h (cost control), but a manual reload enriches them
 * so a deliberately-imported back-catalog ("All events") reaches 'questions_ready'
 * and shows in the inbox instead of rotting at 'detected'.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const NOW = new Date('2026-07-02T12:00:00Z');
// An office-hours entry from ~4 weeks ago - well past the 48h staleness guard.
const PAST_CAPTURE = {
  id: 'cap-old', workspace_id: 'ws-1', user_id: 'u-1',
  title: 'CSE 355 Office Hours', location: null,
  start_time: '2026-06-04T17:00:00Z', end_time: '2026-06-04T18:00:00Z',
  event_type: 'other', is_public_event: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeClient(capture: Record<string, unknown>): { client: any; updates: Array<Record<string, unknown>> } {
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
          q.single = () => ({ data: capture, error: null });
          q.update = (patch: Record<string, unknown>) => ({ eq: () => { updates.push(patch); return Promise.resolve({ error: null }); } });
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
  return { client, updates };
}

function mockDeps(generateEventQuestions = vi.fn().mockResolvedValue([])) {
  vi.doMock('@/lib/ai-budget', () => ({ checkAndIncrementUsage: vi.fn().mockResolvedValue('ok') }));
  vi.doMock('@/lib/event-capture/questions', () => ({ generateEventQuestions }));
  vi.doMock('@/lib/event-capture/research', () => ({
    researchPublicEvent: vi.fn(), researchCacheKey: vi.fn(),
    getCachedResearch: vi.fn(), putCachedResearch: vi.fn(),
  }));
  return generateEventQuestions;
}

describe('Phase: Enrich Past Events (manual reload)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/ai-budget');
    vi.doUnmock('@/lib/event-capture/questions');
    vi.doUnmock('@/lib/event-capture/research');
  });

  it('skips a >48h-old event by default (hourly cron cost control)', async () => {
    mockDeps();
    const { client } = fakeClient(PAST_CAPTURE);
    const { enrichCapture } = await import('@/lib/event-capture/enrich');
    const outcome = await enrichCapture(client, 'cap-old', NOW);
    expect(outcome).toBe('skipped_too_old');
  });

  it('enriches the same past event to questions_ready when ignoreRecency is set (manual reload)', async () => {
    const generateEventQuestions = mockDeps(vi.fn().mockResolvedValue(['q1', 'q2']));
    const { client, updates } = fakeClient(PAST_CAPTURE);
    const { enrichCapture } = await import('@/lib/event-capture/enrich');
    const outcome = await enrichCapture(client, 'cap-old', NOW, { ignoreRecency: true });
    expect(outcome).toBe('questions_ready');
    expect(generateEventQuestions).toHaveBeenCalledTimes(1);
    expect(updates.some((u) => u.status === 'questions_ready')).toBe(true);
  });
});
