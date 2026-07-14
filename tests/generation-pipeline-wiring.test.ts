/**
 * Deep generation-pipeline wiring tests.
 *
 * These do NOT check "did I get an answer". They check that a real generation
 * threads the creator's persona, voice, AND retrieved memory THROUGH the LLM,
 * and that every pipeline stage actually ran - so a silent fallback (e.g. the
 * compact 2-call reroute) can't hide behind a plausible-looking output.
 *
 * The LLM boundary (chatCompletion) is mocked so we can capture every system
 * prompt the model was actually given and assert what reached it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildVoiceContextAdditions } from '@/lib/voice-context';
import { isCompactMode } from '@/lib/content-pipeline/compact';

// --- Mock the LLM boundary: capture calls; return an eval JSON for the judge,
//     a clean draft for every generation stage. ---
const llmCalls: Array<{ system: string; user: string }> = [];
vi.mock('@/lib/llm', () => ({
  isLlmConfigured: () => true,
  LlmError: class LlmError extends Error {
    isQuota = false;
  },
  chatCompletion: vi.fn(async (system: string, user: string) => {
    llmCalls.push({ system, user });
    if (system.includes('You evaluate social content drafts')) {
      // A passing evaluation so the revise loop stops after one pass.
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
    return 'Looking back on the Forbes Summit, here is what stuck with me. Lesson one was concrete. Lesson two mattered more.';
  }),
}));

// Humanize + hooks + observability are collaborators, not the unit under test.
// Passthrough them so the pipeline runs deterministically without a DB or network.
vi.mock('@/lib/humanizer', () => ({
  humanizePipeline: vi.fn(async (text: string) => ({ text, passes: ['mock-humanize'] })),
  deterministicPreClean: (text: string) => text,
}));
vi.mock('@/lib/hooks-intelligence/resolve-hooks', () => ({
  getBestHooksForGeneration: vi.fn(async () => ({
    hooks: [{ id: 'h1', text: 'One line that stops the scroll', author: 'someone' }],
    explanations: [],
    usedStaticFallback: false,
  })),
}));
vi.mock('@/lib/content-pipeline/events', () => ({ emitPipelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/observability/langfuse', () => ({
  withSpan: (_name: string, _attrs: unknown, fn: () => unknown) => fn(),
  flushAfterResponse: () => {},
}));
vi.mock('@/lib/observability/generation-outcome', () => ({
  recordGenerationOutcome: vi.fn().mockResolvedValue(undefined),
}));

import { runContentPipeline } from '@/lib/content-pipeline';

const PROFILE = {
  display_name: 'Ada',
  bio: 'Founder building in AI.',
  bio_facts: 'ex-Stripe, second-time founder',
  voice_description: 'punchy, concrete, no fluff',
  voice_rules: 'short sentences; no buzzwords',
  content_pillars: [{ name: 'founder', weight: 80 }],
};

const DATED_MEMORY =
  '[Your linkedin post from 2026-03-14] - this ALREADY happened; reference as past.\n\n' +
  'I just got back from the Forbes 30 Under 30 Summit and it was incredible.';

const savedEnv = process.env.LLM_PIPELINE_MODE;

beforeEach(() => {
  llmCalls.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.LLM_PIPELINE_MODE;
  else process.env.LLM_PIPELINE_MODE = savedEnv;
});

// --- Task 4: memory reaches the assembled prompt with its date + tense guard ---
describe('memory injection into the prompt (buildVoiceContextAdditions)', () => {
  it('emits the dated PAST CONTENT block with the temporal instruction', () => {
    const out = buildVoiceContextAdditions({ memorySnippets: [DATED_MEMORY] });
    expect(out).toContain('Forbes 30 Under 30');
    expect(out).toContain('2026-03-14');
    expect(out).toContain('PAST CONTENT YOU HAVE ALREADY PUBLISHED');
    // The instruction that actually fixes the tense bug.
    expect(out).toContain('write in the present looking back');
  });
});

// --- Task 5: full pipeline threads persona + memory through the LLM, all stages run ---
describe('full pipeline: persona + memory reach the LLM and every stage runs', () => {
  it('passes voice AND dated memory into an LLM system prompt and completes all stages', async () => {
    process.env.LLM_PIPELINE_MODE = 'full';

    const contextAdditions = buildVoiceContextAdditions({
      bioFacts: PROFILE.bio_facts,
      samplePosts: [{ content: 'A concrete example post from Ada.', platform: 'linkedin' }],
      memorySnippets: [DATED_MEMORY],
    });

    const result = await runContentPipeline({
      userPrompt: 'draft a post remembering the Forbes 30 Under 30 event',
      profile: PROFILE as never,
      contextAdditions,
      useVoice: true,
      platform: 'linkedin',
      contentType: 'post',
      maxIterations: 1,
    });

    const systems = llmCalls.map((c) => c.system);

    // 1. The creator's voice reached the model.
    expect(systems.some((s) => s.includes('punchy, concrete, no fluff'))).toBe(true);
    // 2. The retrieved memory reached the model - with its date and tense guard,
    //    which is what stops "I just got back from" on a "remember" prompt.
    expect(systems.some((s) => s.includes('Forbes 30 Under 30'))).toBe(true);
    expect(systems.some((s) => s.includes('2026-03-14'))).toBe(true);
    expect(systems.some((s) => s.includes('reference as past'))).toBe(true);
    // 3. The judge actually evaluated the draft (prompt was analyzed for quality).
    expect(systems.some((s) => s.includes('You evaluate social content drafts'))).toBe(true);

    // 4. Every stage of the full pipeline ran - not a silent shortcut.
    expect(result.stagesCompleted).toEqual(
      expect.arrayContaining(['base', 'hooks', 'humanize', 'voice', 'evaluate']),
    );
  });

  it('does NOT run the full pipeline behind our back when it should be compact', () => {
    // Guardrail: if this ever flips, the test above is silently exercising compact.
    process.env.LLM_PIPELINE_MODE = 'full';
    expect(isCompactMode(undefined)).toBe(false);
  });
});

// --- Task 6: the silent compact-mode reroute is detectable, not invisible ---
describe('silent fallback detection: compact-mode reroute', () => {
  it('auto-routes small/free models to the compact 2-call pipeline (skips the full chain)', () => {
    delete process.env.LLM_PIPELINE_MODE; // rely on model-size auto-detect
    // The default when nothing is configured is Llama-8B → compact.
    expect(isCompactMode(undefined)).toBe(true);
    expect(isCompactMode('meta-llama/Llama-3.1-8B-Instruct')).toBe(true);
    expect(isCompactMode('llama-3.1-70b-versatile')).toBe(false);
    expect(isCompactMode('gpt-4o')).toBe(false);
  });

  it('LLM_PIPELINE_MODE overrides auto-detect in both directions', () => {
    process.env.LLM_PIPELINE_MODE = 'full';
    expect(isCompactMode('meta-llama/Llama-3.1-8B-Instruct')).toBe(false);
    process.env.LLM_PIPELINE_MODE = 'compact';
    expect(isCompactMode('gpt-4o')).toBe(true);
  });
});
