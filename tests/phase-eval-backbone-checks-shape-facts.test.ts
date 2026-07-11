/**
 * Phase: Eval Backbone - paragraph shape + fabricated specifics.
 * fabricated_specifics is the highest-ROI check: catches invented numbers,
 * names, and stats that are absent from the prompt/context (bug f3b5a5c class).
 */
import { describe, it, expect } from 'vitest';
import { runChecks, type CheckContext } from '@/lib/content-pipeline/checks';

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  contentType: 'post', platform: 'linkedin',
  userPrompt: 'Write about our launch week results',
  sourceContext: 'Launch week: 412 signups, $8,200 MRR added. Quote from Maria Chen: "smoothest onboarding I have seen".',
  ...over,
});

const get = (text: string, id: string, c = ctx()) => runChecks(text, c).find((r) => r.id === id)!;

const FLOWING = [
  'Launch week was a blur. Here is what actually happened.',
  'We added 412 signups in seven days. The MRR jump was $8,200 which beat our target. Maria Chen told us it was the smoothest onboarding she had seen.',
  'The lesson: boring reliability sells itself. We spent zero on ads and let the product demo do the talking. Next week we double down on onboarding.',
  'What did your best launch teach you?',
].join('\n\n');

describe('check: paragraph_shape (hard)', () => {
  it('passes flowing paragraphs with lone hook and closer', () => {
    expect(get(FLOWING, 'paragraph_shape').pass).toBe(true);
  });
  it('fails staccato middles (3+ consecutive one-sentence paragraphs)', () => {
    const staccato = [
      'Launch week was a blur.',
      'We added 412 signups.', 'MRR jumped $8,200.', 'Maria Chen loved onboarding.', 'We spent zero on ads.',
      'What did your best launch teach you?',
    ].join('\n\n');
    expect(get(staccato, 'paragraph_shape').pass).toBe(false);
  });
});

describe('check: fabricated_specifics (hard)', () => {
  it('passes when all numbers and names come from context', () => {
    expect(get(FLOWING, 'fabricated_specifics').pass).toBe(true);
  });
  it('fails on an invented number', () => {
    const r = get(FLOWING.replace('412 signups', '97,000 signups'), 'fabricated_specifics');
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain('97,000');
  });
  it('fails on an invented proper-noun person/company', () => {
    const r = get(FLOWING + '\n\nEven Sundar Pichai reposted it.', 'fabricated_specifics');
    expect(r.pass).toBe(false);
  });
  it('ignores whitelisted small/round numbers and weekdays', () => {
    const r = get(FLOWING + '\n\nTop 3 lessons landed on Tuesday.', 'fabricated_specifics');
    expect(r.pass).toBe(true);
  });
  it('treats profile display name as allowed source', () => {
    const c = ctx({ profile: { display_name: 'Anirudh Chinta' } });
    const r = runChecks(FLOWING + '\n\nAnirudh Chinta here, signing off.', c).find((x) => x.id === 'fabricated_specifics')!;
    expect(r.pass).toBe(true);
  });
  it('ignores a bare calendar year as framing, not a statistic', () => {
    const r = get(FLOWING + '\n\nIn 2024 we doubled down.', 'fabricated_specifics');
    expect(r.pass).toBe(true);
  });
  it('ignores the 24/7 idiom instead of splitting into 24 and 7', () => {
    const r = get(FLOWING + '\n\nSupport runs 24/7 now.', 'fabricated_specifics');
    expect(r.pass).toBe(true);
  });
  it('passes a context-sourced number at end of sentence', () => {
    const r = get(FLOWING + '\n\nFinal tally: 412.', 'fabricated_specifics');
    expect(r.pass).toBe(true);
  });
  it('passes a sentence-final calendar year', () => {
    const r = get(FLOWING + '\n\nWe doubled down in 2024.', 'fabricated_specifics');
    expect(r.pass).toBe(true);
  });
  it('still fails a comma-formatted number that looks like a year', () => {
    const r = get(FLOWING.replace('412 signups', '2,024 signups'), 'fabricated_specifics');
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain('2,024');
  });
});
