/**
 * Audit break 29: /api/event-capture/[id]/process must not strand a capture at
 * 'drafting'. This route is fire-and-forget, so a 500/502 never reaches the
 * caller's .catch — the status itself must revert or the 3s detail poll spins
 * forever. Covers the two exits the original break-19 fix missed:
 *   - the posts insert fails   -> revert to questions_ready (500)
 *   - every generation fails   -> revert to questions_ready, not 'drafted' (502)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const genPipeline = vi.fn();
vi.mock('@/lib/voice-pipeline', () => ({
  generateWithVoicePipeline: (...a: unknown[]) => genPipeline(...a),
}));
vi.mock('@/lib/feature-flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/ai-budget', () => ({ checkAndIncrementUsage: vi.fn().mockResolvedValue('ok') }));
vi.mock('@/lib/voice-context', () => ({
  loadCreatorVoiceContext: vi.fn().mockResolvedValue({ profile: { display_name: 'A', content_pillars: [] }, contextAdditions: '', completeness: {} }),
  fetchL4BaselineBlock: vi.fn().mockResolvedValue(''),
}));
vi.mock('@/lib/hooks-intelligence', () => ({ getBestHooksForContext: vi.fn().mockReturnValue([]) }));

const getServiceClient = vi.fn();
vi.mock('@/lib/insforge/server', () => ({ getServiceClient: () => getServiceClient() }));

import { POST } from '@/app/api/event-capture/[id]/process/route';

const CAPTURE = {
  id: 'cap-1', workspace_id: 'ws-1', user_id: 'user-1', title: 'Demo Day',
  description: null, location: null, start_time: '2026-03-10T17:00:00Z', end_time: '2026-03-10T20:00:00Z',
  event_type: 'conference', is_public_event: true, attendees: null, questions: ['Q'], answers: { '0': 'a' },
};

// Records every event_captures status update so the test can assert the revert.
function makeClient(opts: { insertError?: boolean }) {
  const statusUpdates: string[] = [];
  const client = {
    statusUpdates,
    database: {
      from: (table: string) => {
        if (table === 'event_captures') {
          return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: CAPTURE, error: null }) }) }),
            update: (row: { status: string }) => {
              statusUpdates.push(row.status);
              const p: Promise<{ error: null }> & { eq?: (...a: unknown[]) => unknown } = Promise.resolve({ error: null });
              p.eq = () => { const q: Promise<{ error: null }> & { eq?: () => unknown } = Promise.resolve({ error: null }); q.eq = () => Promise.resolve({ error: null }); return q; };
              return p;
            },
          };
        }
        if (table === 'social_accounts') {
          const b: Record<string, unknown> = {};
          Object.assign(b, { select: () => b, eq: () => b, not: () => b, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [{ platform: 'linkedin', unipile_account_id: 'u1' }], error: null }).then(r) });
          return b;
        }
        if (table === 'event_research') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
        }
        // posts
        return {
          insert: () => ({
            select: () => Promise.resolve(
              opts.insertError
                ? { data: null, error: { message: 'pillar NOT NULL violation' } }
                : { data: [{ id: 'post-1', platform: 'linkedin' }], error: null },
            ),
          }),
        };
      },
    },
  };
  return client;
}

function req() {
  return new Request('http://localhost/api/event-capture/cap-1/process', {
    method: 'POST', headers: { 'x-internal-secret': 'test-secret' },
  }) as never;
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  genPipeline.mockReset().mockResolvedValue({
    text: 'a draft', voice_match_score: 80, ai_score: 20, revised: false, iterations: 1,
    evaluation: {}, stagesCompleted: ['base'], usedHookIds: [], flags: [],
  });
});

describe('event /process never strands at drafting (break 29)', () => {
  it('reverts to questions_ready when the posts insert fails', async () => {
    const client = makeClient({ insertError: true });
    getServiceClient.mockReturnValue(client);

    const res = await POST(req(), { params: { id: 'cap-1' } });
    expect(res.status).toBe(500);
    // Must have reverted, not left at 'drafting'.
    expect(client.statusUpdates).toContain('questions_ready');
    expect(client.statusUpdates).not.toContain('drafted');
  });

  it('reverts (not "drafted") when every platform generation fails', async () => {
    genPipeline.mockRejectedValue(new Error('budget blocked'));
    const client = makeClient({});
    getServiceClient.mockReturnValue(client);

    const res = await POST(req(), { params: { id: 'cap-1' } });
    expect(res.status).toBe(502);
    expect(client.statusUpdates).toContain('questions_ready');
    expect(client.statusUpdates).not.toContain('drafted');
  });

  it('marks drafted on the happy path', async () => {
    const client = makeClient({});
    getServiceClient.mockReturnValue(client);

    const res = await POST(req(), { params: { id: 'cap-1' } });
    expect(res.status).toBe(200);
    expect(client.statusUpdates).toContain('drafted');
  });
});
