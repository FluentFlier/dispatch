/**
 * End-to-end voice-cycle stress test (Task 14, controller-authored).
 *
 * Exercises the REAL pipeline wiring: runContentPipeline, runCompactPipeline
 * (via auto-route), loadCreatorVoiceContext, buildVoiceContextAdditions,
 * buildSystemPrompt, humanizePipeline, evaluateDraft, and the context-split
 * helpers all calling each other for real. Only two seams are mocked:
 *   - @/lib/llm (chatCompletion) - the network boundary
 *   - the InsForge DB client - passed as a plain object, no module mock needed
 * Everything else (humanizer, voice-evaluator, content-pipeline/*, ai,
 * voice-prompts, voice-context, context-split) runs as shipped code so a
 * broken seam between any two of them fails a scenario here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- The one network boundary: chatCompletion. Branches on the system prompt
// so it can play evaluator, analyzer, and generation stage without knowing
// which pipeline stage called it. ---
const chatCompletion = vi.fn(async (system: string, _user: string, _opts?: unknown) => {
  // Evaluator: voice-evaluator.ts EVALUATOR_PROMPT starts with this exact text.
  if (system.startsWith('You evaluate social content drafts')) {
    return JSON.stringify({
      persona_fidelity: 9,
      uniqueness: 9,
      specificity: 9,
      so_what: 9,
      pain_resonance: 9,
      ai_slop: 2,
      revision_notes: '',
    });
  }
  // Voice analyzer (onboarding/voice-lab). Not exercised by scenarios A-F, kept
  // for completeness of the shared smart mock.
  if (system.includes('voice analysis expert')) {
    return JSON.stringify({
      analysis: { tone: 'dry' },
      voice_summary: 's',
      voice_rules: ['DO: be concrete'],
      gap_questions: [],
    });
  }
  // Otherwise a generation stage. Carries a markdown token and a real em dash
  // (unicode escape below, not a literal glyph in this source file) so the
  // finalize/strip guarantees can be asserted for real.
  return 'We shipped the thing today. **bold** and a dash \u2014 done.';
});

vi.mock('@/lib/llm', () => ({
  chatCompletion: (...a: unknown[]) => chatCompletion(...(a as [string, string, unknown?])),
  LlmError: class LlmError extends Error {},
}));

// Scenario E only: loadCreatorVoiceContext's optional-enhancement sources.
// Mocked the same way tests/phase-voice-overhaul-fallback.test.ts does it -
// scenarios A-D never touch these modules (they call runContentPipeline
// directly with a pre-built context string), so this mock is inert for them.
vi.mock('@/lib/supermemory', () => ({ searchUserContext: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/brain/retrieve', () => ({ retrieveBrainContext: vi.fn().mockResolvedValue([]) }));

import { runContentPipeline } from '@/lib/content-pipeline';
import { buildVoiceContextAdditions, loadCreatorVoiceContext } from '@/lib/voice-context';
import type { VocabularyFingerprint, StructuralPatterns } from '@/lib/voice-context';
import { curateSamplePosts } from '@/lib/voice-lab/select-voice-samples';
import type { CreatorProfileForPrompt } from '@/lib/ai';

const EM_DASH = '\u2014';

function isEvaluatorCall(c: unknown[]): boolean {
  return (c[0] as string).startsWith('You evaluate social content drafts');
}
function isGenerationCall(c: unknown[]): boolean {
  const system = c[0] as string;
  return !system.startsWith('You evaluate social content drafts') && !system.includes('voice analysis expert');
}

// --- Fixtures: a realistic voice context string built with the REAL builder
// so section headers (VOICE EXAMPLES, EMAIL VOICE, VOCABULARY FINGERPRINT,
// STRUCTURAL PATTERNS) are exactly what the pipeline expects. ---
const VOCABULARY: VocabularyFingerprint = {
  uses_often: ['shipped', 'tbh'],
  never_uses: ['synergy'],
  signature_phrases: ['ship it and see'],
};
const STRUCTURAL: StructuralPatterns = {
  avg_sentence_length: 'short',
  hook_pattern: 'Opens with a blunt one-line claim',
  paragraph_style: 'short',
  closing_pattern: 'ends on a question',
};
const SAMPLE_POSTS = [
  { content: 'We shipped it on a Tuesday. No launch plan. It worked.', platform: 'linkedin' },
  { content: 'Nobody asked for this feature. I built it anyway and shipped it quiet.', platform: 'linkedin' },
];
const EMAIL_SAMPLES = [
  { content: 'Hey, quick note - shipping today.', platform: 'email' },
];
const PROFILE: CreatorProfileForPrompt = {
  display_name: 'Ani',
  voice_description: 'punchy founder',
  voice_rules: 'DO: be concrete\nNEVER: use buzzwords',
  bio_facts: 'built Ada',
  content_pillars: [],
};

const CONTEXT_ADDITIONS = buildVoiceContextAdditions({
  vocabulary: VOCABULARY,
  structural: STRUCTURAL,
  samplePosts: SAMPLE_POSTS,
  emailSamples: EMAIL_SAMPLES,
});

beforeEach(() => {
  chatCompletion.mockClear();
  delete process.env.LLM_PIPELINE_MODE;
  delete process.env.LLM_MODEL;
});

afterEach(() => {
  delete process.env.LLM_PIPELINE_MODE;
  delete process.env.LLM_MODEL;
});

describe('Voice pipeline end-to-end stress test', () => {
  it('A. compact voice-on: full seam, small-model default', async () => {
    // No env set -> auto-detect. Default model is the HF 8B id, so this routes
    // to the compact pipeline without an explicit LLM_PIPELINE_MODE.
    const result = await runContentPipeline({
      userPrompt: 'write about our launch',
      profile: PROFILE,
      contextAdditions: CONTEXT_ADDITIONS,
      platform: 'linkedin',
      contentType: 'post',
      useVoice: true,
      vocabulary: VOCABULARY,
      structural: STRUCTURAL,
    });

    const genCalls = chatCompletion.mock.calls.filter(isGenerationCall);
    const evalCalls = chatCompletion.mock.calls.filter(isEvaluatorCall);
    expect(genCalls.length).toBe(2);
    expect(evalCalls.length).toBe(1);

    const draftSystem = genCalls[0][0] as string;
    expect(draftSystem).toContain('VOICE EVIDENCE');
    expect(draftSystem).toContain('We shipped it on a Tuesday');
    expect(draftSystem).not.toContain('EMAIL VOICE');
    expect(draftSystem).not.toContain('quick note');

    const editSystem = genCalls[1][0] as string;
    expect(editSystem).toContain('PRESERVE');
    expect(editSystem).toContain('shipped');
    expect(editSystem).toContain('ship it and see');

    expect(result.stagesCompleted).toEqual(['base', 'humanize', 'evaluate']);
    expect(result.text).not.toContain('**');
    expect(result.text).not.toContain(EM_DASH);
    expect(typeof result.voice_match_score).toBe('number');
    expect(result.voice_match_score).toBeGreaterThan(0);
  });

  it('B. full pipeline voice-on: evaluator sees the real voice, creator-first hooks', async () => {
    process.env.LLM_PIPELINE_MODE = 'full';

    const result = await runContentPipeline({
      userPrompt: 'write about our launch',
      profile: PROFILE,
      contextAdditions: CONTEXT_ADDITIONS,
      platform: 'linkedin',
      contentType: 'post',
      useVoice: true,
      vocabulary: VOCABULARY,
      structural: STRUCTURAL,
    });

    const evalCall = chatCompletion.mock.calls.find(isEvaluatorCall);
    expect(evalCall).toBeDefined();
    const evalUserPrompt = evalCall![1] as string;
    expect(evalUserPrompt).toContain('VOICE EVIDENCE');
    expect(evalUserPrompt).toContain('We shipped it on a Tuesday');
    expect(evalUserPrompt).not.toContain('quick note');

    const genSystems = chatCompletion.mock.calls.filter(isGenerationCall).map((c) => c[0] as string);
    expect(genSystems.some((s) => s.includes('Opens with a blunt one-line claim'))).toBe(true);

    expect(result.stagesCompleted).not.toContain('hooks');
    expect(result.stagesCompleted).toContain('voice');
    expect(result.stagesCompleted).toContain('evaluate');
  });

  it('C. voice-off still human (both modes)', async () => {
    for (const mode of ['compact', 'full'] as const) {
      chatCompletion.mockClear();
      process.env.LLM_PIPELINE_MODE = mode;

      const result = await runContentPipeline({
        userPrompt: 'write about our launch',
        profile: null,
        contextAdditions: CONTEXT_ADDITIONS,
        platform: 'linkedin',
        contentType: 'post',
        useVoice: false,
      });

      expect(result.stagesCompleted).toContain('humanize');
      expect(result.stagesCompleted).not.toContain('evaluate');
      expect(result.stagesCompleted).not.toContain('voice');

      const genSystems = chatCompletion.mock.calls.filter(isGenerationCall).map((c) => c[0] as string);
      expect(genSystems.every((s) => !s.includes('VOICE EVIDENCE'))).toBe(true);

      expect(result.text).not.toContain('**');
      expect(result.text).not.toContain(EM_DASH);
    }
  });

  it('D. fast mode short-circuit', async () => {
    process.env.LLM_PIPELINE_MODE = 'compact';

    await runContentPipeline({
      userPrompt: 'write about our launch',
      profile: PROFILE,
      contextAdditions: CONTEXT_ADDITIONS,
      platform: 'linkedin',
      contentType: 'post',
      useVoice: true,
      fast: true,
      vocabulary: VOCABULARY,
      structural: STRUCTURAL,
    });

    const genCalls = chatCompletion.mock.calls.filter(isGenerationCall);
    const evalCalls = chatCompletion.mock.calls.filter(isEvaluatorCall);
    expect(genCalls.length).toBe(1);
    expect(evalCalls.length).toBe(0);
  });

  it('E. fallback honesty through the real loader', async () => {
    function makeBuilder(result: unknown) {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain,
        eq: chain,
        in: chain,
        not: chain,
        order: chain,
        limit: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      });
      return b;
    }
    function makeClient(perTable: Record<string, unknown>) {
      return { database: { from: (t: string) => makeBuilder(perTable[t] ?? { data: null }) } } as never;
    }

    const client = makeClient({
      creator_profile: { data: { display_name: 'Ani', content_pillars: '[]' } },
      user_settings: {
        data: [
          {
            key: 'vocabulary_fingerprint',
            value: JSON.stringify({ uses_often: [], never_uses: ['synergy'], signature_phrases: [] }),
          },
          { key: 'voice_source', value: 'fallback' },
        ],
      },
    });

    const { completeness } = await loadCreatorVoiceContext(client, 'user-1');
    expect(completeness.starved).toBe(true);
    expect(completeness.fingerprint).toBe(false);
    expect(completeness.voiceSource).toBe('fallback');
  });

  it('F. curated few-shot integration: dedupes, caps at 10, longest first', () => {
    function padded(prefix: string, len: number): string {
      const base = `${prefix} `;
      return (base + 'x'.repeat(Math.max(0, len - base.length))).slice(0, len);
    }

    // The near-duplicate pair are the two LONGEST posts in the fixture (400
    // chars each) and share an identical first-80-char head, so they hash to
    // the same dedupe key (content.trim().toLowerCase().slice(0, 80)). Their
    // tails differ, so this is a near-duplicate, not a byte-identical one.
    // Because they are the longest posts, a build with the dedupe filter
    // removed would keep both copies at the very top of the longest-first
    // sort and both would survive the cap-at-10 slice. With dedupe intact,
    // only one copy survives.
    const duplicateHead = padded('recurring keynote opening about how our team scaled growth', 80);
    const duplicateContentA = duplicateHead + 'first variant closes with a note on hiring plans for next quarter.'.padEnd(320, 'x').slice(0, 320);
    const duplicateContentB = duplicateHead + 'second variant closes with a note on roadmap priorities instead.'.padEnd(320, 'x').slice(0, 320);

    // Eight other distinct posts, all shorter than the duplicate pair, so
    // longest-first order and the cap are still exercised across a real
    // spread of lengths.
    const singleLengths = [150, 300, 200, 350, 175, 250, 225, 275];
    const singles = singleLengths.map((len, i) =>
      padded(`unique post ${String.fromCharCode(65 + i)} opening line`, len),
    );

    const samples = [
      { content: duplicateContentA, platform: 'linkedin' },
      { content: singles[0], platform: 'linkedin' },
      { content: singles[1], platform: 'linkedin' },
      { content: duplicateContentB, platform: 'linkedin' },
      { content: singles[2], platform: 'linkedin' },
      { content: singles[3], platform: 'linkedin' },
      { content: singles[4], platform: 'linkedin' },
      { content: singles[5], platform: 'linkedin' },
      { content: singles[6], platform: 'linkedin' },
      { content: singles[7], platform: 'linkedin' },
    ];
    const duplicatesRemoved = 1;

    const curated = curateSamplePosts(samples, 10);

    // Capped at 10.
    expect(curated.length).toBeLessThanOrEqual(10);
    // Exact count: 9 distinct posts survive dedupe and none get cut by the
    // cap, so output length is input length minus duplicates removed. A
    // build without the dedupe filter would keep both duplicate copies
    // (10 raw posts all pass the substance filter), hit the cap-at-10
    // ceiling, and produce a longer, differently composed top-10 - this
    // assertion fails against that build.
    expect(curated.length).toBe(samples.length - duplicatesRemoved);

    // Longest first.
    for (let i = 1; i < curated.length; i++) {
      expect(curated[i - 1].content.length).toBeGreaterThanOrEqual(curated[i].content.length);
    }

    // The near-duplicate pair collapsed to one: at most one post whose
    // content starts with the shared 80-char head may appear in the output.
    // This fails if the dedupe filter is removed, since both 400-char
    // copies are the longest posts and both survive the cap.
    const occurrences = curated.filter((s) => s.content.startsWith(duplicateHead)).length;
    expect(occurrences).toBeLessThanOrEqual(1);
  });
});
