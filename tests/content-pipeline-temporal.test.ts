/**
 * Temporal framing: a retrospective request ("remembering", "looking back",
 * "years ago") must force a past-tense rule into the prompt so generation stops
 * opening with "I just got back from" on a "remember that event" ask. Fires off
 * the user's own wording, so it works regardless of model or memory state.
 */
import { describe, it, expect } from 'vitest';
import { styleRulesFromChecks } from '@/lib/content-pipeline/checks';

const base = {
  platform: 'linkedin',
  contentType: 'post',
  userPrompt: '',
  profile: null,
} as const;

describe('temporal framing rule', () => {
  it('fires on "remembering" and forbids present-tense openers', () => {
    const out = styleRulesFromChecks({
      ...base,
      userPrompt: 'draft a post remembering the Forbes 30 Under 30 event',
    });
    expect(out).toContain('TEMPORAL FRAMING');
    expect(out).toContain('past tense');
    expect(out).toContain('I just got back from');
  });

  it('fires on other retrospective cues', () => {
    for (const p of [
      'looking back on my first startup',
      'a lesson from 3 years ago',
      'a throwback to our launch day',
      'reflecting on last year',
    ]) {
      expect(styleRulesFromChecks({ ...base, userPrompt: p })).toContain('TEMPORAL FRAMING');
    }
  });

  it('does NOT fire on a present/neutral request', () => {
    for (const p of [
      'write a post announcing our new feature',
      'share a tip about cold email',
      'draft a post about why we are hiring',
    ]) {
      expect(styleRulesFromChecks({ ...base, userPrompt: p })).not.toContain('TEMPORAL FRAMING');
    }
  });
});
