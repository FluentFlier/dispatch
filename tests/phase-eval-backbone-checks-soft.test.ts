/**
 * Phase: Eval Backbone - soft signals + bait_hook.
 * Soft checks NEVER gate; bait_hook is hard because LinkedIn's March 2026
 * Authenticity Update suppresses engagement-bait patterns platform-wide.
 */
import { describe, it, expect } from 'vitest';
import { runChecks, type CheckContext } from '@/lib/content-pipeline/checks';

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  contentType: 'post', platform: 'linkedin', userPrompt: 'write about remote work', ...over,
});
const get = (text: string, id: string) => runChecks(text, ctx()).find((r) => r.id === id)!;

const BASE = 'Remote work broke our meeting culture and nobody noticed for a year.\n\n' +
  'We ran fourteen recurring meetings a week when the office closed. By month six people started declining silently and shipping anyway. The work got better while the calendar got emptier, which told us everything.\n\n' +
  'We killed nine of those meetings and wrote three docs instead. Output went up and the team stopped complaining about Zoom fatigue in retros. Nobody asked to bring the meetings back.\n\n' +
  'Which meeting would your team never miss?';

describe('soft checks stay soft', () => {
  it('slop_phrases fails softly on lexicon hits', () => {
    const r = get(BASE + '\n\nTruly a game-changer in the ever-evolving landscape.', 'slop_phrases');
    expect(r.severity).toBe('soft');
    expect(r.pass).toBe(false);
  });
  it('contrast_tell flags the "not X, it\'s Y" pattern', () => {
    const r = get(BASE + "\n\nIt's not about the meetings, it's about trust.", 'contrast_tell');
    expect(r.pass).toBe(false);
  });
  it('burstiness flags uniform sentence rhythm', () => {
    const uniform = Array(8).fill('We shipped another feature this past sprint cycle.').join(' ');
    expect(get(uniform, 'burstiness').pass).toBe(false);
    expect(get(BASE, 'burstiness').pass).toBe(true);
  });
  it('rule_of_three flags stacked triads', () => {
    const triads = BASE + '\n\nFaster, cheaper, and better. Simple, clear, and honest.';
    expect(get(triads, 'rule_of_three').pass).toBe(false);
  });
  it('hook_present flags generic openers', () => {
    const generic = 'I am excited to announce something.\n\n' + BASE;
    expect(get(generic, 'hook_present').pass).toBe(false);
    expect(get(BASE, 'hook_present').pass).toBe(true);
  });
});

describe('check: bait_hook (hard)', () => {
  it.each([
    'Agree?',
    'Comment "GROWTH" if you want the playbook.',
    'Repost if you believe in remote work.',
  ])('fails bait opener: %s', (opener) => {
    const r = get(opener + '\n\n' + BASE, 'bait_hook');
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('hard');
  });
  it('fails broetry ladders (4+ consecutive short lines)', () => {
    const broetry = 'Remote work.\nIt changed.\nEverything we knew.\nForever, honestly.\n\n' + BASE;
    expect(get(broetry, 'bait_hook').pass).toBe(false);
  });
  it('passes a normal strong hook', () => {
    expect(get(BASE, 'bait_hook').pass).toBe(true);
  });
});
