import { z } from 'zod';
import { chatCompletion, type ChatCompletionOptions } from '@/lib/llm';
import { emitPipelineEvent } from './events';

/**
 * Per-stage contract (spec 3.4): text is non-empty, <= 6000 chars, and is not
 * a lone JSON blob when prose was expected. Enforced at every prose-producing
 * chatCompletion call site via callStageChecked below, so a violation always
 * becomes a typed pipeline_events row instead of a bare catch or a silently
 * shipped malformed draft.
 */
const STAGE_LENGTH_CEILING = 6000;
const STAGE_TOKEN_CEILING = 1200;
const STAGE_TIMEOUT_MS = 30_000;

function isLoneJsonBlob(text: string): boolean {
  const t = text.trim();
  const looksLikeJson = (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
  if (!looksLikeJson) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

const StageOutputSchema = z
  .string()
  .trim()
  .min(1, 'empty stage output')
  .max(STAGE_LENGTH_CEILING, `stage output exceeds ${STAGE_LENGTH_CEILING} char ceiling`)
  .refine((s) => !isLoneJsonBlob(s), 'stage output looks like a lone JSON blob, not prose');

export function validateStageOutput(text: string): { ok: true } | { ok: false; reason: string } {
  const result = StageOutputSchema.safeParse(text);
  return result.success ? { ok: true } : { ok: false, reason: result.error.issues[0]?.message ?? 'invalid stage output' };
}

/** Races a promise against a per-stage timeout; rejects with a stage-labeled error on timeout. */
export async function withStageTimeout<T>(promise: Promise<T>, ms: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`stage "${stage}" exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * chatCompletion wrapped with the stage contract: 30s timeout, 1200-token
 * ceiling enforced regardless of what the caller asks for, and post-hoc
 * output validation. A validation failure emits stage_contract_violation and
 * self-heals rather than crashing the whole generation - oversized output is
 * truncated to the ceiling; empty or JSON-shaped output falls back to
 * `previousText` (the last known-good stage output) since there is nothing
 * usable to ship. A timeout rethrows - there is no fallback text for a call
 * that never returned.
 */
export async function callStageChecked(
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions,
  stage: string,
  requestId: string,
  previousText: string,
): Promise<string> {
  const cappedOptions: ChatCompletionOptions = {
    ...options,
    maxTokens: Math.min(options.maxTokens ?? STAGE_TOKEN_CEILING, STAGE_TOKEN_CEILING),
  };

  let raw: string;
  try {
    raw = await withStageTimeout(chatCompletion(systemPrompt, userPrompt, cappedOptions), STAGE_TIMEOUT_MS, stage);
  } catch (err) {
    await emitPipelineEvent({
      requestId, event: 'stage_contract_violation',
      detail: { stage, reason: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  const validation = validateStageOutput(raw);
  if (validation.ok) return raw;

  await emitPipelineEvent({ requestId, event: 'stage_contract_violation', detail: { stage, reason: validation.reason } });
  if (raw.length > STAGE_LENGTH_CEILING) return raw.slice(0, STAGE_LENGTH_CEILING);
  return previousText || raw;
}
