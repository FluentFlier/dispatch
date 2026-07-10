import type { createClient } from '@insforge/sdk';
import { runContentPipeline, type ContentPipelineInput, type ContentPipelineResult } from '@/lib/content-pipeline';
import { resolveModel } from '@/lib/ai-tiers';
import type { VoiceContentType } from '@/lib/voice-prompts';
import type { CreatorProfileForPrompt } from '@/lib/ai';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';

type InsforgeClient = ReturnType<typeof createClient>;

export interface VoicePipelineInput {
  userPrompt: string;
  profile: CreatorProfileForPrompt | null;
  contextAdditions?: string;
  systemOverride?: string;
  platform?: string;
  contentType?: VoiceContentType;
  fast?: boolean;
  useVoice?: boolean;
  preferOpenAi?: boolean;
  skipHooks?: boolean;
  humanizeAlways?: boolean;
  maxIterations?: number;
  mentions?: string[];
  hooksClient?: InsforgeClient;
}

export interface VoicePipelineResult {
  text: string;
  voice_match_score: number;
  ai_score: number;
  revised: boolean;
  flags: string[];
  evaluation?: VoiceEvaluationMatrix;
  iterations: number;
  usedHookIds?: string[];
  hookExplanations?: Array<{ id: string; text: string; author: string; rlScore: number; source: string; reason: string }>;
  stagesCompleted?: string[];
  humanizePasses?: string[];
}

/**
 * End-to-end voice generation via the 4-stage content pipeline:
 * base → hooks → humanize → voice → evaluate.
 */
export async function generateWithVoicePipeline(
  input: VoicePipelineInput,
): Promise<VoicePipelineResult> {
  // preferOpenAi asks for a higher-quality model on this call. Map it to the
  // existing 'smart' model tier (LLM_MODEL_SMART) via the same resolver every
  // other call site uses - no new env knob. Unconfigured (testing) -> undefined,
  // so chatCompletion falls back to the global LLM_MODEL (Groq/HF). This replaces
  // the previously-dead param that never reached chatCompletion.
  const model = input.preferOpenAi ? resolveModel('smart') : undefined;

  const pipelineInput: ContentPipelineInput = {
    userPrompt: input.userPrompt,
    profile: input.profile,
    contextAdditions: input.contextAdditions,
    systemOverride: input.systemOverride,
    platform: input.platform,
    contentType: input.contentType,
    fast: input.fast,
    useVoice: input.useVoice,
    skipHooks: input.skipHooks,
    humanizeAlways: input.humanizeAlways,
    maxIterations: input.maxIterations,
    mentions: input.mentions,
    model,
    hooksClient: input.hooksClient,
  };

  const result: ContentPipelineResult = await runContentPipeline(pipelineInput);

  return {
    text: result.text,
    voice_match_score: result.voice_match_score,
    ai_score: result.ai_score,
    revised: result.revised,
    flags: result.flags,
    evaluation: result.evaluation,
    iterations: result.iterations,
    usedHookIds: result.usedHookIds,
    hookExplanations: result.hookExplanations,
    stagesCompleted: result.stagesCompleted,
    humanizePasses: result.humanizePasses,
  };
}
