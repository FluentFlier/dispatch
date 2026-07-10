import { describe, it, expect } from 'vitest';
import { buildVoiceComposeHints } from '@/lib/voice-prompts';

describe('buildVoiceComposeHints creator-first opening', () => {
  it('uses the creator hook pattern and drops generic hook templates', () => {
    const out = buildVoiceComposeHints('linkedin', 'post', {
      creatorHookPattern: 'Opens with a blunt one-line hot take',
    });
    expect(out).toContain('Opens with a blunt one-line hot take');
    expect(out).toContain('OPENING');
    expect(out).not.toContain('HOOK PATTERNS');
  });

  it('falls back to at most 5 generic hooks framed as optional', () => {
    const out = buildVoiceComposeHints('linkedin', 'post');
    expect(out).toContain('optional inspiration');
    // Scope the count to the hook block itself. GHOSTWRITER_PRINCIPLES (a
    // pre-existing, out-of-scope block) already contains its own numbered
    // list (1-6), so matching the whole output would also count those.
    const hookSection = out.split('HOOK PATTERNS')[1] ?? '';
    const numbered = hookSection.match(/^\d+\. /gm) ?? [];
    expect(numbered.length).toBeLessThanOrEqual(5);
  });
});
