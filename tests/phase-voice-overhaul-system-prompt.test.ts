import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '@/lib/ai';

const PROFILE = { display_name: 'Ani', voice_description: 'punchy' };
const CONTEXT = [
  'BACKGROUND FACTS (use specific details, never genericize):\nBuilt Ada.',
  'VOICE EXAMPLES (match rhythm, tone, and structure; do not copy topics verbatim):\nExample 1:\nWe shipped it.',
  'CREATOR BRAIN (your long-term memory on Content OS):\nbrain snippet',
].join('\n\n');

describe('buildSystemPrompt voice evidence split', () => {
  it('puts voice sections in an authoritative block, not under reference only', () => {
    const out = buildSystemPrompt(PROFILE, CONTEXT);
    const voiceIdx = out.indexOf('VOICE EVIDENCE (authoritative');
    expect(voiceIdx).toBeGreaterThan(-1);
    // The examples live inside the authoritative block, after its header:
    expect(out.indexOf('We shipped it.')).toBeGreaterThan(voiceIdx);
    // The reference-only block still exists for non-voice sections:
    const refIdx = out.indexOf('ADDITIONAL CONTEXT (reference only');
    expect(refIdx).toBeGreaterThan(-1);
    expect(out.indexOf('brain snippet')).toBeGreaterThan(refIdx);
    // And the examples do NOT appear inside the reference block:
    expect(out.indexOf('We shipped it.')).toBeLessThan(refIdx);
  });

  it('keeps plain reference block when no voice sections exist', () => {
    const out = buildSystemPrompt(PROFILE, 'CREATOR BRAIN (x):\nonly brain');
    expect(out).not.toContain('VOICE EVIDENCE');
    expect(out).toContain('ADDITIONAL CONTEXT (reference only');
  });
});
