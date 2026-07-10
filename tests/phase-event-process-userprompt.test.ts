/**
 * Event-capture /process userPrompt assembly guarantees (audit breaks 10/14/16/26).
 * Drives the real POST route with mocked deps and captures the input handed to
 * generateWithVoicePipeline, asserting the event specifics actually reach the model.
 *   - break 14 : attendees + description + key_announcements are in the userPrompt
 *   - break 26 : the extracted research summary is used ("What this event was about")
 *   - break 16 : thin research (no speakers/topics/announcements) is relabeled unverified
 *   - break 10 : the pipeline receives the lowercase platform enum, not the label
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const genPipeline = vi.fn();
vi.mock('@/lib/voice-pipeline', () => ({
  generateWithVoicePipeline: (...a: unknown[]) => genPipeline(...a),
}));
vi.mock('@/lib/feature-flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/ai-budget', () => ({ checkAndIncrementUsage: vi.fn().mockResolvedValue('ok') }));
vi.mock('@/lib/voice-context', () => ({
  loadCreatorVoiceContext: vi.fn().mockResolvedValue({
    profile: { display_name: 'Ani', content_pillars: [] },
    contextAdditions: '',
    completeness: {},
  }),
}));
vi.mock('@/lib/hooks-intelligence', () => ({ getBestHooksForContext: vi.fn().mockReturnValue([]) }));

const getServiceClient = vi.fn();
vi.mock('@/lib/insforge/server', () => ({ getServiceClient: () => getServiceClient() }));

import { POST } from '@/app/api/event-capture/[id]/process/route';

function tableBuilder(cfg: { row?: unknown; rows?: unknown; insertData?: unknown }) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, eq: chain, not: chain, in: chain, order: chain,
    single: () => Promise.resolve({ data: cfg.row ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: cfg.row ?? null, error: null }),
    limit: () => Promise.resolve({ data: cfg.rows ?? [], error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: cfg.rows ?? cfg.row ?? null, error: null }).then(res),
    insert: () => ({ select: () => Promise.resolve({ data: cfg.insertData ?? [{ id: 'post-1', platform: 'linkedin' }], error: null }) }),
    update: () => ({ eq: () => { const p: Promise<unknown> & { eq?: () => Promise<unknown> } = Promise.resolve({ error: null }); p.eq = () => Promise.resolve({ error: null }); return p; } }),
  });
  return b;
}

const CAPTURE = {
  id: 'cap-1', workspace_id: 'ws-1', user_id: 'user-1', title: 'YC W25 Demo Day',
  description: 'Founders pitch to investors at the Demo Day.', location: 'SF',
  start_time: '2026-03-10T17:00:00Z', end_time: '2026-03-10T20:00:00Z',
  event_type: 'conference', is_public_event: true,
  attendees: [{ name: 'Jane Founder' }, { name: 'John Investor' }],
  questions: ['What stood out?'], answers: { '0': 'The energy' },
};

function makeClient(research: unknown) {
  return {
    database: {
      from: (table: string) => {
        if (table === 'event_captures') return tableBuilder({ row: CAPTURE });
        if (table === 'social_accounts') return tableBuilder({ rows: [{ platform: 'linkedin', unipile_account_id: 'u1' }] });
        if (table === 'event_research') return tableBuilder({ row: research });
        if (table === 'posts') return tableBuilder({ insertData: [{ id: 'post-1', platform: 'linkedin' }] });
        return tableBuilder({});
      },
    },
  };
}

function req() {
  return new Request('http://localhost/api/event-capture/cap-1/process', {
    method: 'POST', headers: { 'x-internal-secret': 'test-secret' },
  }) as never;
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  genPipeline.mockReset().mockResolvedValue({
    text: 'a generated post', voice_match_score: 80, ai_score: 20, revised: false,
    iterations: 1, evaluation: {}, stagesCompleted: ['base'], usedHookIds: [], flags: [],
  });
});

describe('event /process userPrompt assembly', () => {
  it('breaks 14/26/10: rich research -> attendees, description, announcements, summary, lowercase platform', async () => {
    const research = {
      summary: 'A demo day where 200 startups pitched.',
      speakers: [{ name: 'Garry Tan' }], key_topics: ['AI', 'fundraising'],
      key_announcements: ['New YC batch size'], sources: ['https://x.com'],
      raw_text: 'Long scraped text about the event.',
    };
    getServiceClient.mockReturnValue(makeClient(research));

    const res = await POST(req(), { params: { id: 'cap-1' } });
    expect(res.status).toBe(200);

    const input = genPipeline.mock.calls[0][0] as { userPrompt: string; platform: string };
    expect(input.platform).toBe('linkedin');                       // break 10: enum, not label
    expect(input.userPrompt).toContain('Jane Founder');            // break 14: attendees
    expect(input.userPrompt).toContain('Founders pitch to investors'); // break 14: description
    expect(input.userPrompt).toContain('New YC batch size');       // break 14: announcements
    expect(input.userPrompt).toContain('What this event was about'); // break 26: summary lead
    expect(input.userPrompt).toContain('A demo day where 200 startups pitched.');
    expect(input.userPrompt).not.toContain('Unverified web snippets'); // rich, not thin
  });

  it('break 16: thin research (no speakers/topics/announcements) is relabeled unverified', async () => {
    const research = {
      summary: 'YC W25 Demo Day', // degraded to title-like
      speakers: [], key_topics: [], key_announcements: [], sources: [],
      raw_text: 'Noisy SERP snippet with no structure.',
    };
    getServiceClient.mockReturnValue(makeClient(research));

    const res = await POST(req(), { params: { id: 'cap-1' } });
    expect(res.status).toBe(200);

    const input = genPipeline.mock.calls[0][0] as { userPrompt: string };
    expect(input.userPrompt).toContain('Unverified web snippets'); // break 16 relabel
    // Thin summary is NOT presented as a confident fact lead.
    expect(input.userPrompt).not.toContain('What this event was about');
  });
});
