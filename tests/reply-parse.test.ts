import { describe, it, expect } from 'vitest';
import { parseReplies } from '@/lib/reply-parse';

/**
 * F4: the Reply tool must map one reply per comment even when a weaker model
 * emits a malformed JSON array (no commas / smart quotes) instead of valid JSON.
 */
describe('parseReplies', () => {
  const comments = ['How did you learn?', 'This scared me too', 'What editor?'];

  it('parses a clean JSON array (one reply per comment)', () => {
    const out = parseReplies('["reply a", "reply b", "reply c"]', comments);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ comment: 'How did you learn?', reply: 'reply a' });
    expect(out[2].reply).toBe('reply c');
  });

  it('recovers a comma-less array (weaker model output)', () => {
    const out = parseReplies('[ "reply a" "reply b" "reply c" ]', comments);
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.reply)).toEqual(['reply a', 'reply b', 'reply c']);
  });

  it('ignores prose around the array', () => {
    const out = parseReplies('Here you go:\n["one", "two", "three"]\nHope that helps', comments);
    expect(out.map((p) => p.reply)).toEqual(['one', 'two', 'three']);
  });

  it('falls back to REPLY markers when there is no array', () => {
    const out = parseReplies('REPLY 1: alpha\nREPLY 2: beta\nREPLY 3: gamma', comments);
    expect(out.map((p) => p.reply)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('never drops comments — pads missing replies', () => {
    const out = parseReplies('["only one"]', comments);
    expect(out).toHaveLength(3);
    expect(out[0].reply).toBe('only one');
    expect(out[1].reply).toBe('(no reply generated)');
  });
});
