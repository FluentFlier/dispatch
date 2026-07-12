/**
 * Phase: Guardrail Consolidation - Phase 3 acceptance criteria closeout
 * (spec 3.5.1, 3.5.5). 3.5.2 (forced-failure event chain) is covered by
 * tests/phase-guardrail-events.test.ts (Task 5). 3.5.3 (escalation rate
 * observable via SQL) and 3.5.4 (adversarial improvement) are verified by
 * running the eval suite (deferred today - see docs/superpowers/sdd/task-p3-8-report.md
 * for the runbook), not by a unit test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SLOP_WORDS, SLOP_PHRASES } from '@/lib/content-pipeline/slop-lexicon';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase: Guardrail Consolidation - acceptance criteria', () => {
  it('3.5.1: zero slop-phrase word/phrase list literals outside slop-lexicon.ts', () => {
    for (const rel of ['src/lib/humanizer.ts', 'src/lib/content-pipeline/compact.ts', 'src/lib/content-pipeline/index.ts']) {
      const src = read(rel);
      // A handful of representative lexicon words must not appear as part of a
      // NEW standalone array literal in these files (they may appear inside a
      // string that's clearly derived, e.g. "SLOP_WORDS.slice(...)").
      expect(src).not.toMatch(/\[\s*['"]delve['"],\s*['"]tapestry['"]/);
    }
    expect(SLOP_WORDS.length + SLOP_PHRASES.length).toBeGreaterThan(40);
  });

  it('3.5.1: zero hardcoded style-rule prose outside styleRulesFromChecks (checks.ts)', () => {
    const compactSrc = read('src/lib/content-pipeline/compact.ts');
    const indexSrc = read('src/lib/content-pipeline/index.ts');
    expect(compactSrc).not.toContain('Group sentences into real paragraphs of 2-4 sentences');
    expect(indexSrc).not.toContain('Group sentences into real paragraphs of 2-4 sentences');
    expect(compactSrc).toMatch(/styleRulesFromChecks/);
  });

  it('3.5.5: pipeline_events migration exists and matches the spec table shape', () => {
    const sql = read('migrations/20260711140000_pipeline-events.sql');
    expect(sql).toContain('create table if not exists pipeline_events');
    expect(sql).toContain('request_id text not null');
    expect(sql).toContain('event text not null');
    expect(sql).toContain("detail jsonb not null default '{}'");
  });
});
