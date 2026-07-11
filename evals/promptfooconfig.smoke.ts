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
 * Smoke suite: fast sanity + hard-check gating on a small case set.
 *
 * Judge: this repo's .env.local only has one LLM router (Groq, via LLM_BASE_URL
 * / LLM_API_KEY), so a true cross-family judge (e.g. Anthropic grading a
 * Groq-generated draft) isn't available locally today. The judge is configured
 * as a promptfoo OpenAI-compatible chat provider pointed at the same router
 * (apiBaseUrl = LLM_BASE_URL, apiKey = LLM_API_KEY) but a DIFFERENT model id
 * (EVAL_JUDGE_MODEL) than the generator uses (LLM_MODEL) - same-family judging,
 * different model. Cross-family judging is deferred until a second provider
 * key exists. Fail loudly if EVAL_JUDGE_MODEL is unset rather than silently
 * skipping judging.
 */
const judgeModel = process.env.EVAL_JUDGE_MODEL;
if (!judgeModel) throw new Error('Set EVAL_JUDGE_MODEL (e.g. "openai/gpt-oss-120b")');
if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY) {
  throw new Error('Set LLM_BASE_URL and LLM_API_KEY (judge provider reuses the generation router)');
}

const judgeProvider = {
  id: `openai:chat:${judgeModel}`,
  config: {
    apiBaseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
  },
};

export function evalCtxFromVars(vars: Record<string, unknown>): CheckContext {
  return {
    contentType: (vars.contentType as string) ?? 'post',
    platform: vars.platform as string | undefined,
    userPrompt: (vars.userPrompt as string) ?? '',
    sourceContext: vars.sourceContext as string | undefined,
    mentions: vars.mentions as string[] | undefined,
  };
}

const config: UnifiedConfig = {
  description: 'Content OS generation - smoke suite',
  prompts: ['{{caseJson}}'],
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
  providers: [
    {
      id: `exec:node "${tsxCli}" --env-file "${envFile}" "${pipelineCli}"`,
      label: 'pipeline',
    },
  ],
  defaultTest: {
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
        value:
          'PASS only if the post delivers what the user request asked for without inventing facts, statistics, people, or anecdotes beyond the provided context. Answer pass or fail with one-sentence reason.',
      },
    ],
  },
  tests: ['file://cases/core/*.yaml'],
  evaluateOptions: { maxConcurrency: 2, repeat: 1 },
};
export default config;
