/**
 * Phase: Write auto-humanize.
 * The streamed Write draft is a single fast LLM pass, so it still carries AI
 * tells. The stream route must run the anti-slop humanizer as a "polishing"
 * stage after the stream completes and swap the polished text into the final
 * `done` event — without a manual Polish tap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  streamCreatorDraft,
  humanizePipeline,
  heuristicAiScore,
  getAuthenticatedUser,
  loadCreatorVoiceContext,
  guardAiRequest,
} = vi.hoisted(() => ({
  streamCreatorDraft: vi.fn(),
  humanizePipeline: vi.fn(),
  heuristicAiScore: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  loadCreatorVoiceContext: vi.fn(),
  guardAiRequest: vi.fn(),
}));

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser,
  getServerClient: () => ({}),
}));
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/voice-context', () => ({ loadCreatorVoiceContext }));
vi.mock('@/lib/ai-guard', () => ({ guardAiRequest }));
vi.mock('@/lib/content-pipeline/stream', () => ({ streamCreatorDraft }));
vi.mock('@/lib/humanizer', () => ({ humanizePipeline, heuristicAiScore }));
vi.mock('@/lib/signals/content-bridge', () => ({
  getSignalTopicsForGeneration: vi.fn().mockResolvedValue([]),
  formatSignalTopicsBlock: () => '',
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/generate/stream/route';
import { NextRequest } from 'next/server';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/generate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .map((chunk) => chunk.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map((json) => JSON.parse(json) as Record<string, unknown>);
}

describe('Phase: Write auto-humanize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUser.mockResolvedValue({ id: 'u1' });
    guardAiRequest.mockResolvedValue({ ok: true });
    loadCreatorVoiceContext.mockResolvedValue({
      profile: { display_name: 'Ada' },
      contextAdditions: '',
      vocabulary: { uses_often: ['ship'], signature_phrases: [] },
      completeness: { starved: false, voiceSource: 'fingerprint' },
    });
    streamCreatorDraft.mockImplementation(async (_input, onToken) => {
      onToken('In today');
      onToken("'s world, we delve into synergy.");
      return { text: "In today's world, we delve into synergy.", usedHookIds: ['h1'] };
    });
    humanizePipeline.mockResolvedValue({
      text: 'Here is the real story, no fluff.',
      passes: ['pre_clean', 'clean', 'audit'],
    });
    heuristicAiScore.mockReturnValue(4);
  });

  it('runs a polishing stage and returns the humanized text in done', async () => {
    const res = await POST(makeRequest({ prompt: 'write about shipping fast', platform: 'linkedin' }));
    const events = await readEvents(res);

    const stages = events.filter((e) => e.type === 'stage').map((e) => e.stage);
    expect(stages).toContain('polishing');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done?.text).toBe('Here is the real story, no fluff.');
    expect(done?.humanized).toBe(true);
    expect(done?.ai_score).toBe(4);
    expect(done?.used_hook_ids).toEqual(['h1']);

    expect(humanizePipeline).toHaveBeenCalledTimes(1);
    // Voice already applied in the streamed system prompt — polish is skipVoice.
    expect(humanizePipeline).toHaveBeenCalledWith(
      "In today's world, we delve into synergy.",
      expect.objectContaining({ skipVoice: true, skipAudit: false }),
    );
  });

  it('skips humanize when humanize:false and returns the raw draft', async () => {
    const res = await POST(
      makeRequest({ prompt: 'write about shipping fast', platform: 'linkedin', humanize: false }),
    );
    const events = await readEvents(res);

    const stages = events.filter((e) => e.type === 'stage').map((e) => e.stage);
    expect(stages).not.toContain('polishing');

    const done = events.find((e) => e.type === 'done');
    expect(done?.text).toBe("In today's world, we delve into synergy.");
    expect(done?.humanized).toBe(false);
    expect(humanizePipeline).not.toHaveBeenCalled();
  });

  it('keeps the streamed draft when humanize throws (non-fatal)', async () => {
    humanizePipeline.mockRejectedValueOnce(new Error('humanize provider down'));

    const res = await POST(makeRequest({ prompt: 'write about shipping fast', platform: 'linkedin' }));
    const events = await readEvents(res);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done?.text).toBe("In today's world, we delve into synergy.");
    expect(done?.humanized).toBe(false);
    // No error event — generation still succeeds.
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
  });
});
