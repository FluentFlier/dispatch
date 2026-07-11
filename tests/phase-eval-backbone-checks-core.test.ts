/**
 * Phase: Eval Backbone - check registry core + simple hard checks.
 * These are MEASUREMENT-only in Phase 1 (no pipeline enforcement yet).
 */
import { describe, it, expect } from 'vitest';
import { runChecks, hardFailures, CHECKS, type CheckContext } from '@/lib/content-pipeline/checks';

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  contentType: 'post', platform: 'linkedin', userPrompt: 'Write a post about shipping our new feature', ...over,
});

const CLEAN_LI_POST = [
  'We shipped the feature everyone kept asking for. Here is what changed.',
  'The old flow made users click through three screens to publish a draft. Support tickets about it kept piling up every week. So we rebuilt the flow around one screen and tested it with twelve users.',
  'Publishing now takes nine seconds on average instead of forty. The first cohort finished onboarding without a single support ticket. That felt like the real win for the team.',
  'What would you simplify next?',
].join('\n\n');

describe('checks: framework', () => {
  it('runs every applicable check exactly once and returns one result per check', () => {
    const results = runChecks(CLEAN_LI_POST, ctx());
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Task 2 registered 4 checks (em_dash, markdown, platform_length, mention_integrity);
    // Task 3 appends paragraph_shape + fabricated_specifics (6 total). Task 4 appends soft
    // checks, raising this count further. Bound reflects checks applicable to CLEAN_LI_POST.
    expect(results.length).toBeGreaterThanOrEqual(6);
  });

  it('clean post passes all hard checks', () => {
    expect(hardFailures(runChecks(CLEAN_LI_POST, ctx()))).toEqual([]);
  });

  it('every check has id, severity, and a fixHint on failure results', () => {
    const dirty = 'Short one — with em dash.';
    for (const r of runChecks(dirty, ctx())) {
      expect(r.id.length).toBeGreaterThan(0);
      if (!r.pass) expect((r.fixHint ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('check: em_dash (hard)', () => {
  it('fails on em and en dashes with evidence', () => {
    const r = runChecks('Great work — truly great.', ctx()).find((x) => x.id === 'em_dash')!;
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('hard');
  });
  it('passes on hyphens', () => {
    const r = runChecks(CLEAN_LI_POST + ' Well-known fact.', ctx()).find((x) => x.id === 'em_dash')!;
    expect(r.pass).toBe(true);
  });
});

describe('check: markdown (hard)', () => {
  it.each([
    ['**bold** text here', 'bold'],
    ['## A Heading\nbody', 'heading'],
    ['```js\ncode\n```', 'fence'],
  ])('fails on %s', (snippet) => {
    const r = runChecks(`${CLEAN_LI_POST}\n\n${snippet}`, ctx()).find((x) => x.id === 'markdown')!;
    expect(r.pass).toBe(false);
  });
  it('passes plain text with snake_case and list dashes', () => {
    const r = runChecks(CLEAN_LI_POST + '\n\n- first point about user_count metrics', ctx()).find((x) => x.id === 'markdown')!;
    expect(r.pass).toBe(true);
  });
});

describe('check: platform_length (hard)', () => {
  it('fails a 300-char post for twitter', () => {
    const long = 'a'.repeat(300);
    const r = runChecks(long, ctx({ platform: 'twitter' })).find((x) => x.id === 'platform_length')!;
    expect(r.pass).toBe(false);
  });
  it('fails a 200-char post for linkedin (under 400 floor)', () => {
    const r = runChecks('short but real sentence here. '.repeat(6), ctx()).find((x) => x.id === 'platform_length')!;
    expect(r.pass).toBe(false);
  });
  it('does not apply to replies', () => {
    const r = runChecks('thanks, appreciate it!', ctx({ contentType: 'reply' })).find((x) => x.id === 'platform_length');
    expect(r).toBeUndefined();
  });
});

describe('check: mention_integrity (hard)', () => {
  it('fails when a requested mention is missing', () => {
    const r = runChecks(CLEAN_LI_POST, ctx({ mentions: ['sama'] })).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(false);
  });
  it('passes when all requested mentions present', () => {
    const r = runChecks(CLEAN_LI_POST + '\n\nThanks @sama for the nudge.', ctx({ mentions: ['@sama'] })).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(true);
  });
  it('fails on invented mentions not in request or context', () => {
    const r = runChecks(CLEAN_LI_POST + '\n\nShoutout @randomperson.', ctx()).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(false);
  });
  it('does not flag an email address in prose as an invented mention', () => {
    const r = runChecks(CLEAN_LI_POST + '\n\nReach me at jane@acme.com for details.', ctx()).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(true);
  });
  it('fails when requested handle "sam" only appears as a substring of "@samsung"', () => {
    const r = runChecks(CLEAN_LI_POST + '\n\nWe love @samsung devices.', ctx({ mentions: ['sam'] })).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(false);
  });
  it('passes when requested handle "sam" appears with punctuation right after it', () => {
    const r = runChecks(CLEAN_LI_POST + '\n\nThanks @sam!', ctx({ mentions: ['sam'] })).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(true);
  });
  it('passes when requested handle is followed by a sentence-final period', () => {
    const r = runChecks(CLEAN_LI_POST + '\n\nThanks @sam.', ctx({ mentions: ['sam'] })).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(true);
  });
  it('strips a trailing period from a scanned handle before the allowed-source lookup', () => {
    const r = runChecks(
      CLEAN_LI_POST + '\n\nGreat work @acme.co. Next topic.',
      ctx({ userPrompt: 'Write a post praising acme.co for shipping fast' }),
    ).find((x) => x.id === 'mention_integrity')!;
    expect(r.pass).toBe(true);
  });
});
