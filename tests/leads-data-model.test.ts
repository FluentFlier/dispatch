/**
 * F7 DATA MODEL (leads rebuild audit).
 *
 * The abandoned lead_catalog shared-catalog experiment must stay dead: zero
 * references anywhere in src/. This guard keeps it from resurrecting via a
 * copy-pasted query or a stale import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively lists .ts/.tsx files under a directory. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('F7: lead_catalog stays removed', () => {
  it('no file under src/ references lead_catalog', () => {
    const offenders = walk(join(process.cwd(), 'src')).filter((f) =>
      readFileSync(f, 'utf8').includes('lead_catalog'),
    );
    expect(
      offenders,
      `lead_catalog was torn down and must not come back; found in: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
