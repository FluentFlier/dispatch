import type { createClient } from '@insforge/sdk';
import { runContentPipeline, type ContentPipelineInput, type ContentPipelineResult } from '@/lib/content-pipeline';
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
  // preferOpenAi asks for a higher-quality model on this call. There is no direct
  // OpenAI provider wired; map it to an optional premium model env so the flag has
  // real effect where one is configured, and is a graceful no-op otherwise. This
  // replaces the previously-dead param that never reached chatCompletion.
  const premiumModel = process.env.LLM_PREMIUM_MODEL?.trim();
  const model = input.preferOpenAi && premiumModel ? premiumModel : undefined;

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
