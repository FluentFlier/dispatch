import type { createClient } from '@insforge/sdk';
import { buildSystemPrompt, type CreatorProfileForPrompt } from '@/lib/ai';
import { chatCompletionStream, type StreamTokenHandler } from '@/lib/llm';
import { buildVoiceComposeHints, type VoiceContentType } from '@/lib/voice-prompts';
import { getBestHooksForGeneration } from '@/lib/hooks-intelligence/resolve-hooks';
import { PILLAR_TO_VERTICAL, type HookVertical } from '@/lib/hooks-intelligence/types';
import { profilePillarWeights } from '@/lib/pillars';
import { stripMarkdownFormatting, buildCheckContext } from '@/lib/content-pipeline';
import { styleRulesFromChecks } from './checks';

type InsforgeClient = ReturnType<typeof createClient>;

export type StreamDraftMode = 'draft' | 'revise';

export interface StreamDraftInput {
  userPrompt: string;
  profile: CreatorProfileForPrompt | null;
  contextAdditions?: string;
  platform?: string;
  contentType?: VoiceContentType;
  useVoice?: boolean;
  /** 'draft' pulls hook guidance; 'revise' edits an existing draft the prompt already contains. */
  mode: StreamDraftMode;
  mentions?: string[];
  hooksClient?: InsforgeClient;
}

export interface StreamDraftResult {
  text: string;
  usedHookIds: string[];
}

/** Em dashes render badly on social and read as AI - normalize to hyphens. */
function stripEmDashes(text: string): string {
  return text.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-');
}

/**
 * The single streamed call sometimes slips into chat mode and prefixes the
 * post with its own meta-commentary ("Here's the revised text:", "Sure,
 * here's your post:") instead of returning only the post. Strip a leading
 * line like that before it ships as the literal first line of the draft.
 */
function stripLeadingPreamble(text: string): string {
  const lines = text.split('\n');
  const first = lines[0]?.trim() ?? '';
  const isPreamble =
    /^(here'?s?|here is|sure|okay|certainly|absolutely)\b.{0,80}:$/i.test(first) && first.length < 100;
  return isPreamble ? lines.slice(1).join('\n').replace(/^\n+/, '') : text;
}

function topWeightedVertical(profile: CreatorProfileForPrompt | null): HookVertical | undefined {
  const weights = profilePillarWeights(profile?.content_pillars);
  const entries = Object.entries(weights);
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => b[1] - a[1]);
  return PILLAR_TO_VERTICAL[entries[0][0]];
}

/**
 * Interactive, low-latency generation for the Write chat.
 *
 * WHY separate from runContentPipeline: the full pipeline runs 6-10 sequential
 * LLM calls (base → hooks → humanize → voice → evaluate → revise) which is great
 * for one-shot quality but terrible for a chat where the creator iterates. Here
 * we merge voice + hook guidance + platform format into ONE streamed call so
 * tokens appear immediately. Deeper cleanup stays one tap away via "Polish"
 * (the humanizer), and cron/agent surfaces keep using the full pipeline.
 */
export async function streamCreatorDraft(
  input: StreamDraftInput,
  onToken: StreamTokenHandler,
): Promise<StreamDraftResult> {
  const useVoice = input.useVoice !== false;
  const profile = useVoice ? input.profile : null;
  const composeHints = buildVoiceComposeHints(input.platform, input.contentType ?? 'post');

  let usedHookIds: string[] = [];
  let hookGuidance = '';

  // Hook intelligence only helps a fresh draft; a revision keeps the existing opener.
  if (input.mode === 'draft' && useVoice) {
    try {
      const vertical = topWeightedVertical(profile);
      const resolved = await getBestHooksForGeneration(input.hooksClient, {
        nicheId: (profile as { niche_id?: string | null } | null)?.niche_id ?? undefined,
        topicText: input.userPrompt.slice(0, 1000),
        vertical,
        limit: 5,
      });
      usedHookIds = resolved.hooks.map((h) => h.id);
      if (resolved.hooks.length > 0) {
        hookGuidance = `HOOK PATTERNS (adapt the STRUCTURE to this topic, never copy the words):\n${resolved.hooks
          .map((h, i) => `${i + 1}. "${h.text}"`)
          .join('\n')}`;
      }
    } catch {
      // Hook DB may be unavailable - proceed without learned hooks.
    }
  }

  const mentionHint =
    input.mentions && input.mentions.length > 0
      ? `Include these @mentions naturally where relevant: ${input.mentions
          .map((m) => (m.startsWith('@') ? m : `@${m}`))
          .join(', ')}`
      : '';

  const checkCtx = buildCheckContext(input, input.contentType ?? 'post', input.contextAdditions, profile);
  const rules = styleRulesFromChecks(checkCtx);

  const system = [
    buildSystemPrompt(profile, input.contextAdditions || undefined),
    composeHints,
    hookGuidance,
    mentionHint,
    rules,
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await chatCompletionStream(
    system,
    input.userPrompt,
    // Draft on the main generation model (LLM_GENERATE_*, e.g. GPT-5.5) when set.
    { temperature: 0.72, maxTokens: 1200, role: 'generate' },
    onToken,
  );

  // Final clean pass. Streamed deltas may briefly show markdown/em-dash noise;
  // the client swaps in this cleaned text on completion.
  return { text: stripLeadingPreamble(stripMarkdownFormatting(stripEmDashes(raw))), usedHookIds };
}
