/**
 * Phase: Niche Hooks - retrieval rewrite + dead-code deletions.
 * Guards: mock-engagers block is gone from getHookContextForAgent; saveHookDataset
 * no longer writes to fs; the niche path samples arms then keeps the existing
 * head/tail diversity dedup on the final set.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', 'lib', p), 'utf8');

describe('dead-code deletions (spec 2.4)', () => {
  it('mock-engagers block removed from retriever.ts', () => {
    const r = src('hooks-intelligence/retriever.ts');
    expect(r).not.toMatch(/mockEngagers/);
    expect(r).not.toMatch(/bucketEngagers/);
  });
  it('saveHookDataset no longer calls fs.writeFileSync', () => {
    const idx = src('hooks-intelligence/index.ts');
    expect(idx).not.toMatch(/writeFileSync/);
  });
  it('never uses the banned Set spread', () => {
    for (const f of ['hooks-intelligence/retriever.ts', 'hooks-intelligence/resolve-hooks.ts']) {
      expect(src(f)).not.toMatch(/\[\s*\.\.\.[a-zA-Z_]+Set/);
    }
  });
});

import { getBestHooksForGeneration } from '@/lib/hooks-intelligence/resolve-hooks';

describe('getBestHooksForGeneration fallback (no client)', () => {
  it('falls back to the static path and returns <= limit unique hooks', async () => {
    const res = await getBestHooksForGeneration(undefined, { topicText: 'launching my SaaS', vertical: 'ai', limit: 3 });
    expect(res.hooks.length).toBeLessThanOrEqual(3);
    const ids = res.hooks.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
