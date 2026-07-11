import { resolve } from 'node:path';
import type { UnifiedConfig } from 'promptfoo';
import { runChecks, hardFailures, type CheckContext } from '../src/lib/content-pipeline/checks';

// promptfoo runs exec providers with cwd = the config file's own directory
// (config.basePath = "evals" here), not the process cwd - so a relative
// command string like "node node_modules/tsx/..." resolves against
// evals/node_modules, which doesn't exist. Build absolute paths from this
// file's own location instead; cwd-independent regardless of what basePath
// promptfoo picks.
const repoRoot = resolve(__dirname, '..');
const tsxCli = resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const envFile = resolve(repoRoot, '.env.local');
const pipelineCli = resolve(repoRoot, 'evals/providers/pipeline-cli.ts');

/**
 * Judge: separate provider (Cerebras) from the generator (Groq via LLM_*).
 * Two reasons: (1) cross-provider judging - the judge no longer shares the
 * generator's key, so 334 judge calls per full run stop competing with the
 * pipeline for the same Groq rate limit (the shared-key setup made full runs
 * crawl under 429 backoff contention); (2) EVAL_JUDGE_MODEL stays the model
 * pin (same gpt-oss-120b id, served by Cerebras). Base URL is hardcoded and
 * the key read directly from CEREBRAS_API_KEY - deliberately NOT configurable
 * via extra envs, so the judge config can't drift silently between runs;
 * changing the judge means editing this file in a reviewed PR. Fail loudly if
 * either env is unset rather than silently skipping judging.
 */
const judgeModel = process.env.EVAL_JUDGE_MODEL;
if (!judgeModel) throw new Error('Set EVAL_JUDGE_MODEL (e.g. "gpt-oss-120b")');
if (!process.env.CEREBRAS_API_KEY) {
  throw new Error('Set CEREBRAS_API_KEY (judge provider runs on Cerebras, separate from the generation router)');
}

export const judgeProvider = {
  id: `openai:chat:${judgeModel}`,
  config: {
    apiBaseUrl: 'https://api.cerebras.ai/v1',
    apiKey: process.env.CEREBRAS_API_KEY,
  },
};

export function evalCtxFromVars(vars: Record<string, unknown>): CheckContext {
  // caseJson is the single source of truth (it's what the pipeline actually
  // received). Parse it rather than reading mirrored top-level vars: a
  // top-level ARRAY var (e.g. mentions) makes promptfoo expand one case into
  // N test rows (observed: adversarial/mention-stuffing ran 5x -> 171 rows
  // for 167 cases), so arrays must never be top-level vars. Top-level
  // mirrors remain only for {{userPrompt}} rubric rendering.
  let fromCase: Partial<CheckContext> = {};
  try {
    fromCase = JSON.parse((vars.caseJson as string) ?? '{}');
  } catch {
    /* fall back to top-level vars */
  }
  return {
    contentType: fromCase.contentType ?? (vars.contentType as string) ?? 'post',
    platform: fromCase.platform ?? (vars.platform as string | undefined),
    userPrompt: fromCase.userPrompt ?? (vars.userPrompt as string) ?? '',
    sourceContext: fromCase.sourceContext ?? (vars.sourceContext as string | undefined),
    mentions: fromCase.mentions ?? (vars.mentions as string[] | undefined),
  };
}

// `npx tsx` invokes npx.cmd on Windows, which Node's execFile (no shell) can't
// spawn directly (ENOENT) - the exec provider shells out via execFile, not a
// shell, so it must be a real executable. Run tsx's own entry via `node`
// instead: portable and avoids the npx wrapper entirely. All paths are
// absolute (see repoRoot/tsxCli/etc above) since the exec cwd is this
// config's directory, not the repo root.
// NOTE: `--env-file "<path>"` (space, not `=`) - promptfoo's exec-provider
// tokenizer (parseScriptParts) treats a quoted segment as one token only
// when the whole token is quoted; `--env-file="<path>"` splits into
// `--env-file=` and the bare path as two separate argv entries.
export const provider = {
  id: `exec:node "${tsxCli}" --env-file "${envFile}" "${pipelineCli}"`,
  label: 'pipeline',
};

export const defaultTest: UnifiedConfig['defaultTest'] = {
  options: { provider: judgeProvider }, // grader for llm-rubric assertions
  assert: [
    {
      type: 'javascript',
      value: async (output: string, testCase: any) => {
        const ctx = evalCtxFromVars(testCase.vars ?? {});
        const failures = hardFailures(runChecks(output, ctx));
        return failures.length === 0
          ? true
          : { pass: false, score: 0, reason: failures.map((f) => `${f.id}: ${f.evidence}`).join(' | ') };
      },
    },
    {
      type: 'llm-rubric',
      value:
        'PASS only if a busy professional would believe a human wrote this post. FAIL if it reads AI-generated (uniform rhythm, generic claims, corporate vocabulary). Answer pass or fail with one-sentence reason.',
    },
    {
      type: 'llm-rubric',
      // {{userPrompt}} is a mirrored top-level var on every case (see cases/*.yaml
      // and generate-cases.ts makeCase) - promptfoo renders vars into rubric
      // strings, so the judge sees the actual request instead of grading blind.
      value:
        'PASS only if the post delivers what this specific user request asked for, without inventing facts, statistics, people, or anecdotes beyond the provided context.\n\nUser request: "{{userPrompt}}"\n\nAnswer pass or fail with one-sentence reason.',
    },
  ],
};
