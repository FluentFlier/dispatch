/**
 * F6 NURTURE STATE (leads rebuild audit).
 *
 * The nurture stage machine must be a single source of truth:
 * (a) every stage in the NurtureStage type must be reachable - a stage no
 *     code ever writes ('nurturing' today) is dead vocabulary and must be
 *     wired or removed;
 * (b) direction matters: an inbound message sets needs_reply true, an
 *     outbound reply clears it, and the two directions must not collapse
 *     into one shared 'replied' stage value.
 *
 * The state transitions live in DB-bound functions, so these assert against
 * source (repo convention, see tests/phase-guardrail-*.test.ts) plus todos
 * for the DB-bound transitions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Recursively lists .ts/.tsx files under a directory. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("F6a: 'nurturing' stage is reachable or absent", () => {
  it("'nurturing' is either written somewhere in src or removed from the NurtureStage type", () => {
    const types = read('src/lib/signals/types.ts');
    const inType = /\|\s*'nurturing'/.test(types);
    if (!inType) return; // removed from the type - that satisfies the finding

    const writeRe = /nurture_stage['"]?\s*[:=]\s*['"]nurturing['"]/;
    const written = walk(join(process.cwd(), 'src')).some((f) =>
      writeRe.test(readFileSync(f, 'utf8')),
    );
    expect(
      written,
      "'nurturing' is in the NurtureStage type but no code ever sets it - wire a transition to it or delete it from the type",
    ).toBe(true);
  });
});

describe('F6a: connection acceptance advances connect_sent to dm_ready', () => {
  it('the dm-stage cron selects connect_sent leads and writes dm_ready', () => {
    const src = read('src/lib/gtm/nurture/dm-stage.ts');
    expect(src).toMatch(/'connect_sent'/);
    expect(src).toMatch(/nurture_stage:\s*'dm_ready'/);
  });

  it.todo(
    'integration: prepareDueFollowUpDms with a 1st-degree connect_sent lead past due must update the row to nurture_stage dm_ready with a drafted DM (DB + Unipile bound)',
  );
});

describe('F6b: needs_reply direction', () => {
  it('an inbound message sets needs_reply true', () => {
    expect(read('src/lib/signals/leads/inbound-message.ts')).toMatch(/needs_reply:\s*true/);
  });

  it('sending an outbound reply clears needs_reply', () => {
    expect(read('src/lib/signals/outreach/send-reply.ts')).toMatch(/needs_reply:\s*false/);
  });

  it("inbound and outbound paths do not share the one 'replied' stage value in both directions", () => {
    // 'they replied to me' and 'I replied to them' are different states; if
    // both paths stamp nurture_stage 'replied', the stage alone is ambiguous
    // and every consumer must re-derive direction from needs_reply.
    const inboundWritesReplied = /nurture_stage:\s*'replied'/.test(
      read('src/lib/signals/leads/inbound-message.ts'),
    );
    const outboundWritesReplied = /nurture_stage:\s*'replied'/.test(
      read('src/lib/signals/outreach/send-reply.ts'),
    );
    expect(
      inboundWritesReplied && outboundWritesReplied,
      "both directions write nurture_stage 'replied' - give the two meanings distinct stage values",
    ).toBe(false);
  });
});
