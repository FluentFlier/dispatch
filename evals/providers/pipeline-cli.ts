/**
 * promptfoo exec-provider: runs the REAL content pipeline for one eval case.
 * Input: argv[2] = JSON {userPrompt, platform, contentType, useVoice, profileFixture, mentions, sourceContext}
 * Output: generated post text on stdout (promptfoo captures it).
 * Exit 1 + stderr on failure so promptfoo marks the case errored, not empty-pass.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Eval runs pin to the PRIMARY provider only (LLM_* = Groq). With
// HUGGINGFACE_API_KEY present, llm.ts fails over to the HF router on any 429
// instead of retrying the primary - and when HF monthly credits are depleted
// (402), every case under concurrency dies instantly (observed: 168/171 rows
// errored in the 2026-07-11 full run). Deleting the fallback env restores
// llm.ts's in-place 429 retry/backoff path, which is also more deterministic
// for evals (one model generates everything). Env is read lazily per call, so
// deleting before the pipeline import is belt-and-braces but safe either way.
delete process.env.HUGGINGFACE_API_KEY;
delete process.env.LLM_FALLBACK_BASE_URL;
delete process.env.LLM_FALLBACK_API_KEY;
delete process.env.LLM_FALLBACK_MODEL;

import { runContentPipeline } from '../../src/lib/content-pipeline';

interface CaseVars {
  userPrompt: string;
  platform?: string;
  contentType?: string;
  useVoice?: boolean;
  profileFixture?: string; // filename in evals/fixtures/profiles/
  mentions?: string[];
  sourceContext?: string;
}

async function main() {
  const raw = process.argv[2];
  if (!raw) throw new Error('missing case JSON arg');
  const vars = JSON.parse(raw) as CaseVars;

  let profile = null;
  let vocabulary;
  let structural;
  if (vars.profileFixture) {
    const fx = JSON.parse(
      readFileSync(join(__dirname, '..', 'fixtures', 'profiles', vars.profileFixture), 'utf8'),
    );
    profile = fx.profile;
    vocabulary = fx.vocabulary;
    structural = fx.structural;
  }

  const result = await runContentPipeline({
    userPrompt: vars.userPrompt,
    profile,
    platform: vars.platform,
    contentType: (vars.contentType ?? 'post') as never,
    useVoice: vars.useVoice ?? Boolean(profile),
    vocabulary,
    structural,
    mentions: vars.mentions,
    contextAdditions: vars.sourceContext,
  });

  process.stdout.write(result.text);
}

main().catch((e) => {
  console.error(e);
  // exitCode (not process.exit): on Windows, stderr to a pipe is async and
  // process.exit(1) drops the buffered write - promptfoo then records
  // "Command failed" with an empty stderr, hiding the real error (observed:
  // 149/168 errors in the 2026-07-11 full run had no stderr).
  process.exitCode = 1;
});
