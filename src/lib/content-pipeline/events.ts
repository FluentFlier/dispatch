/**
 * Fire-and-forget pipeline degradation event emitter (spec 3.3). Every
 * branch where the pipeline silently falls back, revises, or escalates
 * writes one row here so "what % of requests ran compact / escalated /
 * shipped below threshold" is a one-query answer instead of invisible.
 *
 * getServiceClient is imported lazily - it pulls in next/headers via
 * @/lib/insforge/server, which only resolves inside a Next.js runtime. A
 * static import would break every non-Next caller of the content pipeline
 * (e.g. the promptfoo eval CLI), same root cause as llm-budget.ts.
 *
 * "Fire-and-forget" here means error-swallowing, not un-awaited: callers DO
 * await this (it never throws, never blocks on anything but one insert), the
 * same idiom src/lib/admin/cron-log.ts already uses. An un-awaited insert
 * risks being cut off mid-flight when a serverless function returns before
 * it completes (the same class of bug Langfuse's forceFlush gotcha guards
 * against) - awaiting a call that cannot fail the caller avoids that for a
 * negligible latency cost against multi-second LLM calls.
 *
 * EVALS_MODE gate: the promptfoo eval CLI (evals/providers/pipeline-cli.ts)
 * runs the real pipeline outside Next but in the same process, so
 * getServiceClient() can succeed there too (it only reads env vars, no
 * cookies()) - if InsForge env vars are present in that shell it would
 * otherwise write real rows into the prod/dev pipeline_events table. Set
 * EVALS_MODE=1 before importing the pipeline from a non-generation caller to
 * skip writes entirely (not counted as a swallowed error - it's a deliberate
 * no-op, not a failure).
 */

export type PipelineEventType =
  | 'compact_mode'
  | 'hook_fallback_static'
  | 'targeted_revise'
  | 'escalated'
  | 'hard_check_failed'
  | 'judge_parse_error'
  | 'provider_retry'
  | 'shipped_below_threshold'
  | 'stage_contract_violation'
  // Research stage (Stage 0, opt-in): research_failed is a degradation
  // (requested research did not enrich the draft); research_complete is an
  // observation row like generation_complete - keep it out of degradation lists.
  | 'research_complete'
  | 'research_failed'
  // Not a degradation: one row per finished generation (Phase 4 observation
  // record). This is the DENOMINATOR dashboards divide every other event
  // count by to get a rate - keep it out of any "degradation types" list.
  | 'generation_complete';

export interface PipelineEventInput {
  requestId: string;
  userId?: string;
  event: PipelineEventType;
  detail?: Record<string, unknown>;
}

let swallowedErrorCount = 0;

/** Last console.warn timestamp per event type - caps warn spam to once per
 * minute per event type when a sink is persistently broken.
 * ponytail: process-local Map, resets on redeploy; fine for a warn throttle. */
const lastWarnedAt = new Map<string, number>();
const WARN_INTERVAL_MS = 60_000;

function warnRateLimited(event: string, ...args: unknown[]): void {
  const now = Date.now();
  const last = lastWarnedAt.get(event) ?? 0;
  if (now - last < WARN_INTERVAL_MS) return;
  lastWarnedAt.set(event, now);
  console.warn(...args);
}

/** Number of emitPipelineEvent calls that failed silently since the process
 * started (or since the last resetSwallowedEventErrorCount) - a health check
 * can alert if this climbs, meaning the sink itself is broken. */
export function getSwallowedEventErrorCount(): number {
  return swallowedErrorCount;
}

/** Test-only reset. */
export function resetSwallowedEventErrorCount(): void {
  swallowedErrorCount = 0;
}

export async function emitPipelineEvent(input: PipelineEventInput): Promise<void> {
  if (process.env.EVALS_MODE) return;

  try {
    const { getServiceClient } = await import('@/lib/insforge/server');
    const client = getServiceClient();
    const { error } = await client.database.from('pipeline_events').insert([
      {
        request_id: input.requestId,
        user_id: input.userId ?? null,
        event: input.event,
        detail: input.detail ?? {},
      },
    ]);
    if (error) {
      swallowedErrorCount += 1;
      warnRateLimited(input.event, `[pipeline-events] insert failed (${input.event}):`, error.message);
    }
  } catch (err) {
    swallowedErrorCount += 1;
    warnRateLimited(input.event, `[pipeline-events] unexpected error (${input.event}):`, err);
  }
}
