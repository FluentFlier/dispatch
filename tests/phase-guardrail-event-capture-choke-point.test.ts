/**
 * Phase: Guardrail Consolidation - event-capture single choke point (spec
 * 0.1 verification, not a rewrite). All enforcement/events/stage-contract
 * work landed in Tasks 1-6 lives inside runContentPipeline, reached only via
 * generateWithVoicePipeline. If the event-capture regenerate path ever forks
 * its own generation call, it silently loses every guarantee this plan
 * built. This is a source-level guard, cheap to run on every commit,
 * catching that drift even though the existing mocked tests
 * (phase-event-process-*.test.ts) would not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_PATH = 'src/app/api/event-capture/[id]/process/route.ts';
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase: Guardrail Consolidation - event-capture routes through the single choke point', () => {
  it('imports generateWithVoicePipeline from @/lib/voice-pipeline', () => {
    const src = read(ROUTE_PATH);
    expect(src).toMatch(/import\s*\{[^}]*generateWithVoicePipeline[^}]*\}\s*from\s*['"]@\/lib\/voice-pipeline['"]/);
  });

  it('calls generateWithVoicePipeline (not just imports it unused)', () => {
    const src = read(ROUTE_PATH);
    expect(src).toMatch(/generateWithVoicePipeline\s*\(/);
  });

  it('does not import chatCompletion or runContentPipeline directly (no bypass of the choke point)', () => {
    const src = read(ROUTE_PATH);
    expect(src).not.toMatch(/from ['"]@\/lib\/llm['"]/);
    expect(src).not.toMatch(/from ['"]@\/lib\/content-pipeline['"]/);
  });
});
