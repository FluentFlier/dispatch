import type { UnifiedConfig } from 'promptfoo';
import { provider, defaultTest } from './shared';

/**
 * Smoke suite: fast sanity + hard-check gating on a small case set.
 * Shared judge/provider/assertion wiring lives in evals/shared.ts.
 */
const config: UnifiedConfig = {
  description: 'Content OS generation - smoke suite',
  prompts: ['{{caseJson}}'],
  providers: [provider],
  defaultTest,
  // Explicit file, not a cases/core/*.yaml glob: Task 7 adds generated.yaml
  // (~120 cases) into that same directory for the full suite. A glob here
  // would silently balloon every smoke run from 3 cases to 120+.
  tests: ['file://cases/core/sanity.yaml'],
  evaluateOptions: { maxConcurrency: 2, repeat: 1 },
};
export default config;
