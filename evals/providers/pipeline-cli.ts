/**
 * promptfoo exec-provider: runs the REAL content pipeline for one eval case.
 * Input: argv[2] = JSON {userPrompt, platform, contentType, useVoice, profileFixture, mentions, sourceContext}
 * Output: generated post text on stdout (promptfoo captures it).
 * Exit 1 + stderr on failure so promptfoo marks the case errored, not empty-pass.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  process.exit(1);
});
