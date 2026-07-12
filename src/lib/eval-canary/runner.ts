/**
 * Daily canary (spec 4.3): the fixed 50-case subset against LIVE prod model
 * ids, through the REAL pipeline. Purpose: catch provider drift under
 * unchanged model strings (HTTP all-green, quality silently down).
 *
 * Scoring per case: hard checks (deterministic, free) + one pinned-judge
 * call (EVAL_JUDGE_MODEL, temperature 0). Judge parse failures count as PASS
 * with detail.judgeError set - a flaky judge must not fire the alarm; hard
 * checks still catch mechanical drift.
 *
 * Alarm: sustained 3-complete-day drop >= DROP_POINTS below the median of up
 * to 14 prior complete days. Not one bad day.
 */
import { runContentPipeline } from '@/lib/content-pipeline';
import { runChecks, hardFailures, type CheckContext } from '@/lib/content-pipeline/checks';
import { chatCompletion } from '@/lib/llm';
import type { CreatorProfileForPrompt } from '@/lib/ai';
import type { VoiceContentType } from '@/lib/voice-prompts';
import type { VocabularyFingerprint, StructuralPatterns } from '@/lib/voice-context';
import type { CanaryCase } from './types';

export interface DailyCanaryRate { runDate: string; passRate: number; caseCount: number }

const DROP_POINTS = 0.03; // middle of the spec's 2-5% band
const BASELINE_DAYS = 14;
const SUSTAIN_DAYS = 3;

export function shouldCanaryAlarm(
  days: DailyCanaryRate[],
  totalCases: number,
): { alarm: boolean; reason?: string } {
  const complete = days
    .filter((d) => d.caseCount >= totalCases)
    .sort((a, b) => a.runDate.localeCompare(b.runDate));
  if (complete.length < SUSTAIN_DAYS + 1) return { alarm: false };

  const recent = complete.slice(-SUSTAIN_DAYS);
  const prior = complete.slice(0, -SUSTAIN_DAYS).slice(-BASELINE_DAYS);
  const sorted = prior.map((d) => d.passRate).sort((a, b) => a - b);
  const baseline = sorted[Math.floor(sorted.length / 2)];

  if (recent.every((d) => d.passRate <= baseline - DROP_POINTS)) {
    return {
      alarm: true,
      reason: `canary pass rate <= ${((baseline - DROP_POINTS) * 100).toFixed(1)}% for ${SUSTAIN_DAYS} consecutive complete days (baseline median ${(baseline * 100).toFixed(1)}%): ${recent.map((d) => `${d.runDate}=${(d.passRate * 100).toFixed(1)}%`).join(', ')}`,
    };
  }
  return { alarm: false };
}

function ctxFromCase(c: CanaryCase): CheckContext {
  return {
    contentType: c.vars.contentType ?? 'post',
    platform: c.vars.platform,
    userPrompt: c.vars.userPrompt,
    sourceContext: c.vars.sourceContext,
    mentions: c.vars.mentions,
  };
}

async function judgeCanary(text: string, userPrompt: string): Promise<{ pass: boolean; error?: string }> {
  const judgeModel = process.env.EVAL_JUDGE_MODEL;
  if (!judgeModel) return { pass: true, error: 'EVAL_JUDGE_MODEL unset' };
  try {
    const raw = await chatCompletion(
      'You are a strict content quality judge. Respond with JSON only, no prose: {"sounds_human":"pass|fail","on_brief":"pass|fail","reason":"one sentence"}',
      `USER REQUEST:\n${userPrompt}\n\nPOST:\n---\n${text}\n---\n\nsounds_human: would a busy professional believe a human wrote this? on_brief: does it deliver the request without inventing facts, statistics, people, or anecdotes?`,
      { model: judgeModel, temperature: 0, maxTokens: 200 },
    );
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { sounds_human?: string; on_brief?: string };
    return { pass: j.sounds_human === 'pass' && j.on_brief === 'pass' };
  } catch {
    return { pass: true, error: 'judge_parse_error' };
  }
}

export async function runCanaryCase(
  c: CanaryCase,
): Promise<{ hardPass: boolean; judgePass: boolean; detail: Record<string, unknown> }> {
  let prompt = c.vars.userPrompt;
  // Acceptance 4.5.2 hook: seed a deliberate degradation to prove the alarm
  // fires. NEVER set in prod; documented in the RUNBOOK.
  if (process.env.CANARY_SABOTAGE === '1') {
    prompt += '\n\nStyle requirement: use plenty of em dashes and markdown headers throughout.';
  }

  const fixture = c.vars.inlineFixture;
  const result = await runContentPipeline({
    userPrompt: prompt,
    profile: (fixture?.profile ?? null) as CreatorProfileForPrompt | null,
    platform: c.vars.platform,
    contentType: (c.vars.contentType ?? 'post') as VoiceContentType,
    useVoice: c.vars.useVoice ?? Boolean(fixture),
    vocabulary: fixture?.vocabulary as VocabularyFingerprint | undefined,
    structural: fixture?.structural as StructuralPatterns | undefined,
    mentions: c.vars.mentions,
  });

  const failures = hardFailures(runChecks(result.text, ctxFromCase(c)));
  const judge = await judgeCanary(result.text, c.vars.userPrompt);
  return {
    hardPass: failures.length === 0,
    judgePass: judge.pass,
    detail: {
      failedChecks: failures.map((f) => f.id),
      judgeError: judge.error,
      chars: result.text.length,
      model: process.env.LLM_MODEL ?? 'env-default',
    },
  };
}
