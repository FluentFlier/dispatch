import { describe, it, expect } from 'vitest';
import {
  substanceContextOnly,
  voiceEvidenceOnly,
  stripSections,
  VOICE_EVIDENCE_HEADERS,
} from '@/lib/content-pipeline/context-split';

const CONTEXT = [
  'BACKGROUND FACTS (use specific details, never genericize):\nBuilt Ada. YC W25.',
  'VOCABULARY FINGERPRINT:\nWords/phrases they use often: shipped, tbh',
  'STRUCTURAL PATTERNS:\nSentence length: short',
  'VOICE EXAMPLES (match rhythm, tone, and structure; do not copy topics verbatim):\nExample 1 (linkedin):\nWe shipped it.\n\nSecond paragraph of the same example.',
  'EMAIL VOICE (how they write 1:1 - match warmth, explanation style, sign-offs):\nEmail 1:\nHey, quick note.',
  'CREATOR BRAIN (your long-term memory on Content OS):\nsnippet',
].join('\n\n');

describe('voiceEvidenceOnly', () => {
  it('keeps exactly fingerprint + structural + examples, with multi-paragraph bodies intact', () => {
    const out = voiceEvidenceOnly(CONTEXT)!;
    expect(out).toContain('VOCABULARY FINGERPRINT:');
    expect(out).toContain('STRUCTURAL PATTERNS:');
    expect(out).toContain('Second paragraph of the same example.');
    expect(out).not.toContain('BACKGROUND FACTS');
    expect(out).not.toContain('EMAIL VOICE');
    expect(out).not.toContain('CREATOR BRAIN');
  });

  it('returns undefined when no voice sections exist', () => {
    expect(voiceEvidenceOnly('BACKGROUND FACTS (x):\nfacts')).toBeUndefined();
    expect(voiceEvidenceOnly(undefined)).toBeUndefined();
  });
});

describe('stripSections', () => {
  it('removes only the named sections', () => {
    const out = stripSections(CONTEXT, ['EMAIL VOICE'])!;
    expect(out).not.toContain('EMAIL VOICE');
    expect(out).toContain('VOICE EXAMPLES');
    expect(out).toContain('CREATOR BRAIN');
  });

  it('can strip all voice evidence via the exported header list', () => {
    const out = stripSections(CONTEXT, VOICE_EVIDENCE_HEADERS)!;
    expect(out).not.toContain('VOCABULARY FINGERPRINT:');
    expect(out).not.toContain('VOICE EXAMPLES');
    expect(out).toContain('BACKGROUND FACTS');
  });
});

describe('substanceContextOnly (regression)', () => {
  it('still excludes EMAIL VOICE and keeps voice signal', () => {
    const out = substanceContextOnly(CONTEXT)!;
    expect(out).not.toContain('EMAIL VOICE');
    expect(out).toContain('VOCABULARY FINGERPRINT:');
    expect(out).toContain('BACKGROUND FACTS');
  });
});
