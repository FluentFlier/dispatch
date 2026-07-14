/**
 * Phase: Posts + email voice (magical voice from multi-source ingest)
 */
import { describe, it, expect } from 'vitest';
import { cleanEmailBodyForVoice } from '@/lib/composio/actions/gmail-read';
import { selectBalancedVoiceSamples } from '@/lib/voice-lab/select-voice-samples';

describe('Phase: Posts + email voice', () => {
  describe('cleanEmailBodyForVoice', () => {
    it('should strip HTML and quoted reply blocks', () => {
      const raw = `<p>Hey team - quick update on the launch.</p>
> On Mon, Alex wrote:
> old thread stuff
From: someone@example.com`;

      const cleaned = cleanEmailBodyForVoice(raw);
      expect(cleaned).toContain('Hey team');
      expect(cleaned).not.toContain('old thread');
      expect(cleaned).not.toContain('From:');
    });

    it('should collapse whitespace for voice samples', () => {
      const cleaned = cleanEmailBodyForVoice('Hello   there\n\n  world');
      expect(cleaned).toBe('Hello there world');
    });
  });

  describe('selectBalancedVoiceSamples', () => {
    it('should reserve slots for emails when present', () => {
      const posts = Array.from({ length: 15 }, (_, i) => ({
        content: 'p'.repeat(100 + i),
        platform: 'LinkedIn',
      }));
      const emails = Array.from({ length: 8 }, (_, i) => ({
        content: 'e'.repeat(80 + i),
        platform: 'Email',
      }));

      const selected = selectBalancedVoiceSamples([...posts, ...emails], 20);
      const emailCount = selected.filter((s) => s.platform === 'Email').length;
      const postCount = selected.filter((s) => s.platform !== 'Email').length;

      expect(selected).toHaveLength(20);
      expect(emailCount).toBeGreaterThanOrEqual(2);
      expect(postCount).toBeGreaterThan(emailCount);
    });

    it('should use all social slots when no emails', () => {
      const posts = Array.from({ length: 25 }, (_, i) => ({
        content: 'x'.repeat(i + 10),
        platform: 'X',
      }));

      const selected = selectBalancedVoiceSamples(posts, 20);
      expect(selected).toHaveLength(20);
      expect(selected.every((s) => s.platform === 'X')).toBe(true);
    });
  });
});
