import type { UnifiedConfig } from 'promptfoo';
import { provider, defaultTest } from './shared';
import { CANARY_CASES } from '../src/lib/eval-canary/cases';

/**
 * Canary suite: the SAME fixed 50 cases the daily cron runs, exercised
 * through the standard promptfoo harness for local/manual comparison
 * (e.g. reproducing a canary alarm on a dev machine).
 * Spec 4.3 names this file promptfooconfig.canary.yaml; it is .ts because
 * this repo's configs share judge/provider wiring from evals/shared.ts,
 * which yaml cannot import.
 *
 * vars shape mirrors evals/cases/core/sanity.yaml exactly (userPrompt,
 * platform, contentType, caseJson at top level only) rather than spreading
 * CanaryCaseVars directly: spreading would put `mentions` (an array) and
 * `inlineFixture` (an object, cron-only - the local exec provider reads
 * profileFixture from disk like every other suite) at the top level, and
 * shared.ts documents that top-level array vars make promptfoo expand one
 * case into N rows (the 2026-07 mention-stuffing incident: 5x row blowup).
 * caseJson is reconstructed to match exactly what pipeline-cli.ts parses.
 */
const config: UnifiedConfig = {
  description: 'Content OS generation - daily canary subset',
  prompts: ['{{caseJson}}'],
  providers: [provider],
  defaultTest,
  tests: CANARY_CASES.map((c) => {
    const { userPrompt, platform, contentType, useVoice, sourceContext, mentions, profileFixture } = c.vars;
    const caseJson = JSON.stringify({ userPrompt, platform, contentType, useVoice, sourceContext, mentions, profileFixture });
    return {
      description: c.description,
      // platform/contentType are always set by the generator; `?? ''` only
      // satisfies promptfoo's Vars type (no undefined), not a real fallback.
      vars: { userPrompt, platform: platform ?? '', contentType: contentType ?? '', caseJson },
    };
  }),
  evaluateOptions: { maxConcurrency: 2, repeat: 1 },
};
export default config;
