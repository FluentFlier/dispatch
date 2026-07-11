import type { UnifiedConfig } from 'promptfoo';
import { provider, defaultTest } from './shared';

/**
 * Full suite: golden dataset (core + holdout) + adversarial history cases.
 * Shared judge/provider/assertion wiring lives in evals/shared.ts.
 * Holdout is included here (its own category label) so regressions surface,
 * but must NEVER be referenced during prompt iteration - see cases/holdout/holdout.yaml.
 */
const config: UnifiedConfig = {
  description: 'Content OS generation - full suite',
  prompts: ['{{caseJson}}'],
  providers: [provider],
  defaultTest,
  tests: [
    'file://cases/core/*.yaml',
    'file://cases/adversarial/*.yaml',
    'file://cases/holdout/*.yaml',
  ],
  evaluateOptions: { maxConcurrency: 3, repeat: 1 },
};
export default config;
