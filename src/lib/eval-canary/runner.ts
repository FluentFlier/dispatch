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
  // Mirror prod Gate B (buildCheckContext in content-pipeline/index.ts): pass the
  // fixture's display_name so fabricatedSpecifics allow-lists the creator's own
  // name. Omitting it flags the creator's name as a fabricated proper noun in
  // canary scoring when prod would not - noise in the very pass-rate the alarm keys on.
  const fixture = c.vars.inlineFixture;
  return {
    contentType: c.vars.contentType ?? 'post',
    platform: c.vars.platform,
    userPrompt: c.vars.userPrompt,
    sourceContext: c.vars.sourceContext,
    mentions: c.vars.mentions,
    profile: fixture?.profile ? { display_name: (fixture.profile as { display_name?: string }).display_name } : null,
  };
}

// Judge routes to Cerebras directly (base URL + CEREBRAS_API_KEY), NOT through
// the app's chatCompletion router. Same split as the promptfoo eval suite
// (evals/shared.ts): the generator runs on the Groq LLM_* router and the judge
// on a SEPARATE Cerebras key, so 50 daily judge calls never contend with the
// generation rate limit (and never burn the exhausted Groq free-tier budget).
// EVAL_JUDGE_MODEL is the model pin (gpt-oss-120b, served by Cerebras).
// Fail-open on any error: a flaky judge must not fire the alarm; hard checks
// still catch mechanical drift.
const CEREBRAS_JUDGE_URL = 'https://api.cerebras.ai/v1/chat/completions';

async function judgeCanary(text: string, userPrompt: string): Promise<{ pass: boolean; error?: string }> {
  const judgeModel = process.env.EVAL_JUDGE_MODEL;
  if (!judgeModel) return { pass: true, error: 'EVAL_JUDGE_MODEL unset' };
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) return { pass: true, error: 'CEREBRAS_API_KEY unset' };
  try {
    const res = await fetch(CEREBRAS_JUDGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: judgeModel,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: 'You are a strict content quality judge. Respond with JSON only, no prose: {"sounds_human":"pass|fail","on_brief":"pass|fail","reason":"one sentence"}' },
          { role: 'user', content: `USER REQUEST:\n${userPrompt}\n\nPOST:\n---\n${text}\n---\n\nsounds_human: would a busy professional believe a human wrote this? on_brief: does it deliver the request without inventing facts, statistics, people, or anecdotes?` },
        ],
      }),
    });
    if (!res.ok) return { pass: true, error: `judge_http_${res.status}` };
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = body.choices?.[0]?.message?.content ?? '';
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
