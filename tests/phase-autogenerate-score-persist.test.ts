/**
 * Audit break 28: /api/auto-generate must persist a genuine 0 voice/ai score as 0,
 * not null. ai_score = ai_slop * 10, and ai_slop 0 (fully human, the BEST score) is
 * falsy — `|| null` dropped it from the flywheel. This pins the `?? null` fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const genPipeline = vi.fn();
vi.mock('@/lib/voice-pipeline', () => ({
  generateWithVoicePipeline: (...a: unknown[]) => genPipeline(...a),
}));
vi.mock('@/lib/voice-context', () => ({
  loadCreatorVoiceContext: vi.fn().mockResolvedValue({
    profile: { display_name: 'Ani', content_pillars: [{ name: 'build' }] },
    contextAdditions: '', completeness: {},
  }),
}));
vi.mock('@/lib/workspace', () => ({ getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1') }));
vi.mock('@/lib/ai-guard', () => ({ guardAiRequest: vi.fn().mockResolvedValue({ ok: true }) }));

const getAuthenticatedUser = vi.fn();
let insertedPayload: Record<string, unknown> | null = null;
vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: () => getAuthenticatedUser(),
  getServerClient: () => ({
    database: {
      from: (table: string) => {
        if (table === 'user_settings') {
          return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) };
        }
        // posts
        return {
          insert: (rows: Record<string, unknown>[]) => {
            insertedPayload = rows[0];
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'post-1' }, error: null }) }) };
          },
        };
      },
    },
  }),
}));

import { POST } from '@/app/api/auto-generate/route';

function req(body: unknown) {
  return new Request('http://localhost/api/auto-generate', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }) as never;
}

beforeEach(() => {
  insertedPayload = null;
  getAuthenticatedUser.mockResolvedValue({ id: 'user-1' });
  genPipeline.mockReset();
});

describe('auto-generate score persistence (break 28)', () => {
  it('persists ai_score 0 and voice_match_score 0 as 0, not null', async () => {
    genPipeline.mockResolvedValue({
      text: 'clean post', voice_match_score: 0, ai_score: 0, revised: false,
      iterations: 1, evaluation: { ai_slop: 0 }, stagesCompleted: ['base'], usedHookIds: [], flags: [],
    });

    const res = await POST(req({ type: 'original', platform: 'linkedin', topic: 'x' }));
    expect(res.status).toBe(200);
    expect(insertedPayload?.ai_score).toBe(0);         // was null under `|| null`
    expect(insertedPayload?.voice_match_score).toBe(0);
  });

  it('still stores a normal score unchanged', async () => {
    genPipeline.mockResolvedValue({
      text: 'post', voice_match_score: 82, ai_score: 20, revised: true,
      iterations: 2, evaluation: {}, stagesCompleted: ['base', 'voice'], usedHookIds: [], flags: [],
    });
    await POST(req({ type: 'original', platform: 'linkedin', topic: 'x' }));
    expect(insertedPayload?.ai_score).toBe(20);
    expect(insertedPayload?.voice_match_score).toBe(82);
  });
});
