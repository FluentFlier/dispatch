import { describe, expect, it } from 'vitest';
import { normalizeMeetingLink, meetingLinkPromptLine } from '@/lib/signals/leads/meeting-link';

describe('normalizeMeetingLink', () => {
  it('accepts Calendly URLs', () => {
    const link = normalizeMeetingLink('https://calendly.com/founder/15min');
    expect(link?.provider).toBe('calendly');
    expect(link?.url).toBe('https://calendly.com/founder/15min');
  });

  it('adds https when missing', () => {
    const link = normalizeMeetingLink('calendly.com/founder/15min');
    expect(link?.url).toBe('https://calendly.com/founder/15min');
  });

  it('rejects localhost', () => {
    expect(normalizeMeetingLink('http://localhost:3000/book')).toBeNull();
  });

  it('builds prompt line for drafts', () => {
    const line = meetingLinkPromptLine(normalizeMeetingLink('https://calendly.com/x/y')!);
    expect(line).toContain('https://calendly.com/x/y');
  });
});
