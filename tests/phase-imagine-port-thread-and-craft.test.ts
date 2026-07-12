/**
 * Phase: Imagine port - thread mode + craft exemplars.
 * Covers the thread_shape hard check (X threads as ----separated tweet
 * sequences) and the compose-hint wiring for the ported craft principles,
 * hook formulas, and comment masterclass.
 */
import { describe, it, expect } from 'vitest';
import { runChecks, splitThread, styleRulesFromChecks, type CheckContext } from '@/lib/content-pipeline/checks';
import { buildVoiceComposeHints } from '@/lib/voice-prompts';

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  contentType: 'thread', platform: 'twitter',
  userPrompt: 'Write a thread about shipping a side project in 30 days',
  sourceContext: 'Shipped waitlist page day 3. 900 signups by day 30.',
  ...over,
});

const get = (text: string, id: string, c = ctx()) => runChecks(text, c).find((r) => r.id === id);

const VALID_THREAD = [
  'I shipped a side project in 30 days. 900 people signed up. Here is the playbook.',
  'Day 3: waitlist page live. Not the product, the promise. You learn more from 50 signups than 5 mockups.',
  'Days 4 to 20: built only what the waitlist emails asked for. Every feature request that showed up twice got built. Everything else got a polite no.',
  'Day 30: 900 signups. The lesson: scope is a decision you make daily, not once.',
  'If you are sitting on an idea, ship the promise first. What would your waitlist page say?',
].join('\n---\n');

describe('check: thread_shape (hard)', () => {
  it('passes a valid ----separated thread', () => {
    expect(get(VALID_THREAD, 'thread_shape')!.pass).toBe(true);
  });

  it('fails when there are no --- separators (single blob)', () => {
    const r = get('One long unbroken ramble about shipping side projects with no separators at all.', 'thread_shape')!;
    expect(r.pass).toBe(false);
    expect(r.fixHint).toContain('---');
  });

  it('fails when any tweet exceeds 280 characters', () => {
    const long = 'x'.repeat(300);
    const r = get(['Hook tweet under limit.', long, 'Closing tweet.'].join('\n---\n'), 'thread_shape')!;
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain('tweet 2');
  });

  it('fails threads with more than 12 tweets', () => {
    const bloated = Array.from({ length: 14 }, (_, i) => `Tweet number ${i + 1} with one idea.`).join('\n---\n');
    expect(get(bloated, 'thread_shape')!.pass).toBe(false);
  });

  it('does not apply to regular posts', () => {
    expect(get('A normal post.', 'thread_shape', ctx({ contentType: 'post' }))).toBeUndefined();
  });

  it('tolerates blank lines around separators when splitting', () => {
    expect(splitThread('a\n\n---\n\nb\n --- \nc')).toEqual(['a', 'b', 'c']);
  });
});

describe('thread contentType check gating', () => {
  it('exempts threads from platform_length and paragraph_shape (post-only checks)', () => {
    const ids = runChecks(VALID_THREAD, ctx()).map((r) => r.id);
    expect(ids).not.toContain('platform_length');
    expect(ids).not.toContain('paragraph_shape');
  });

  it('still applies base hygiene (em_dash) to threads', () => {
    const r = get(VALID_THREAD.replace('the playbook', 'the playbook — full story'), 'em_dash')!;
    expect(r.pass).toBe(false);
  });

  it('emits the thread format rule in the prompt rules block', () => {
    expect(styleRulesFromChecks(ctx())).toContain('Thread format');
    expect(styleRulesFromChecks(ctx({ contentType: 'post' }))).not.toContain('Thread format');
  });
});

describe('compose hints: ported craft exemplars', () => {
  it('includes craft principles for posts and threads, not comments', () => {
    expect(buildVoiceComposeHints('linkedin', 'post')).toContain('POST CRAFT');
    expect(buildVoiceComposeHints('twitter', 'thread')).toContain('POST CRAFT');
    expect(buildVoiceComposeHints('linkedin', 'comment')).not.toContain('POST CRAFT');
  });

  it('gives threads thread opener formulas and posts hook formulas', () => {
    expect(buildVoiceComposeHints('twitter', 'thread')).toContain('THREAD OPENER FORMULAS');
    expect(buildVoiceComposeHints('linkedin', 'post')).toContain('HOOK FORMULAS');
    expect(buildVoiceComposeHints('linkedin', 'post')).not.toContain('THREAD OPENER FORMULAS');
  });

  it('creator opening style still suppresses all generic hook guidance (audit P0-3)', () => {
    const hints = buildVoiceComposeHints('twitter', 'thread', { creatorHookPattern: 'opens with a blunt one-liner' });
    expect(hints).toContain('OPENING (authoritative)');
    expect(hints).not.toContain('THREAD OPENER FORMULAS');
    expect(hints).not.toContain('HOOK FORMULAS');
  });

  it('comments get the comment masterclass and no hook guidance', () => {
    const hints = buildVoiceComposeHints('linkedin', 'comment');
    expect(hints).toContain('COMMENT CRAFT');
    expect(hints).not.toContain('HOOK FORMULAS');
    expect(hints).not.toContain('HOOK PATTERNS');
  });

  it('thread hint instructs the --- separator format', () => {
    expect(buildVoiceComposeHints('twitter', 'thread')).toContain('THREAD MODE');
  });
});
