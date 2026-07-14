/**
 * Phase: Write auto-humanize (revise/light path).
 * First drafts now run the full staged pipeline; the single-call streaming path
 * (streamCreatorDraft) serves follow-up edits (mode 'revise'). That streamed
 * draft is one fast LLM pass, so it still carries AI tells - the route runs the
 * anti-slop humanizer as a "polishing" stage after the stream completes and
 * swaps the polished text into the final `done` event, without a manual Polish tap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  streamCreatorDraft,
  runContentPipeline,
  humanizePipeline,
  heuristicAiScore,
  getAuthenticatedUser,
  loadCreatorVoiceContext,
  guardAiRequest,
  saveGenerationContext,
  loadGenerationContext,
  recordRegen,
} = vi.hoisted(() => ({
  streamCreatorDraft: vi.fn(),
  runContentPipeline: vi.fn(),
  humanizePipeline: vi.fn(),
  heuristicAiScore: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  loadCreatorVoiceContext: vi.fn(),
  guardAiRequest: vi.fn(),
  saveGenerationContext: vi.fn(),
  loadGenerationContext: vi.fn(),
  recordRegen: vi.fn(),
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
vi.mock('@/lib/content-pipeline', () => ({ runContentPipeline }));
vi.mock('@/lib/generation-context', () => ({
  saveGenerationContext,
  loadGenerationContext,
  recordRegen,
  REGEN_LIGHT_LIMIT: 3,
}));
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
    saveGenerationContext.mockResolvedValue('ctx-1');
    loadGenerationContext.mockResolvedValue(null);
    recordRegen.mockResolvedValue(undefined);
    runContentPipeline.mockResolvedValue({
      text: 'Full pipeline draft, in voice.',
      voice_match_score: 88,
      ai_score: 12,
      usedHookIds: ['h1'],
      flags: [],
      revised: true,
      iterations: 1,
      stagesCompleted: ['base', 'voice', 'evaluate'],
    });
  });

  it('first draft runs the full pipeline, returns its text + score + context_id', async () => {
    const res = await POST(makeRequest({ prompt: 'write about shipping fast', platform: 'linkedin' }));
    const events = await readEvents(res);

    expect(runContentPipeline).toHaveBeenCalledTimes(1);
    expect(streamCreatorDraft).not.toHaveBeenCalled();

    const done = events.find((e) => e.type === 'done');
    expect(done?.text).toBe('Full pipeline draft, in voice.');
    expect(done?.voice_match_score).toBe(88);
    expect(done?.context_id).toBe('ctx-1');
    expect(saveGenerationContext).toHaveBeenCalledTimes(1);
  });

  it('runs a polishing stage and returns the humanized text in done', async () => {
    const res = await POST(makeRequest({ prompt: 'write about shipping fast', platform: 'linkedin', mode: 'revise' }));
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
      makeRequest({ prompt: 'write about shipping fast', platform: 'linkedin', humanize: false, mode: 'revise' }),
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

    const res = await POST(makeRequest({ prompt: 'write about shipping fast', platform: 'linkedin', mode: 'revise' }));
    const events = await readEvents(res);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done?.text).toBe("In today's world, we delve into synergy.");
    expect(done?.humanized).toBe(false);
    // No error event — generation still succeeds.
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
  });
});
