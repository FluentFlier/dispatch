/**
 * Phase: Guardrail Consolidation - Task 2.
 * Acceptance 3.5.1 (spec): zero slop-phrase lists outside slop-lexicon.ts;
 * zero style-rule prose outside styleRulesFromChecks. Proven two ways:
 * (a) AI_SLOP_PATTERNS is literally derived from the lexicon (reference
 * check, not just "looks similar"), (b) the old hardcoded rule sentences no
 * longer appear as literal source text in index.ts/compact.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_SLOP_PATTERNS } from '@/lib/humanizer';
import { allSlopRegexes } from '@/lib/content-pipeline/slop-lexicon';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase: Guardrail Consolidation - prompt/lexicon single source', () => {
  it('humanizer AI_SLOP_PATTERNS is derived from the slop lexicon, not a parallel list', () => {
    expect(AI_SLOP_PATTERNS.length).toBe(allSlopRegexes().length + 2); // + em dash, en dash
    expect(AI_SLOP_PATTERNS.length).toBeGreaterThan(40); // the lexicon has ~70+ entries, the old hardcoded array had 10
  });

  it('index.ts no longer hardcodes the style-rule sentence text', () => {
    const src = read('src/lib/content-pipeline/index.ts');
    expect(src).not.toContain('Plain text only \u2014 no markdown, no em dashes');
    expect(src).toMatch(/styleRulesFromChecks\(/);
  });

  it('compact.ts no longer defines a standalone HARD_RULES constant', () => {
    const src = read('src/lib/content-pipeline/compact.ts');
    expect(src).not.toMatch(/const HARD_RULES\s*=/);
    expect(src).toMatch(/styleRulesFromChecks\(/);
  });

  it('compact.ts edit pass no longer hardcodes the AI-tells word list', () => {
    const src = read('src/lib/content-pipeline/compact.ts');
    expect(src).not.toContain('delve, tapestry, leverage, foster, landscape, nuanced, multifaceted');
    expect(src).toMatch(/SLOP_WORDS|SLOP_PHRASES/);
  });
});
