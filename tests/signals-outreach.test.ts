import { describe, expect, it } from 'vitest';
import { parseLinkedInPublicIdentifier } from '@/lib/signals/outreach/unipile-linkedin';

describe('parseLinkedInPublicIdentifier', () => {
  it('passes through plain handles', () => {
    expect(parseLinkedInPublicIdentifier('janedoe')).toBe('janedoe');
    expect(parseLinkedInPublicIdentifier('@janedoe')).toBe('janedoe');
  });

  it('extracts from /in/ profile URLs', () => {
    expect(parseLinkedInPublicIdentifier('https://www.linkedin.com/in/janedoe/')).toBe('janedoe');
    expect(parseLinkedInPublicIdentifier('https://linkedin.com/in/janedoe?utm=1')).toBe('janedoe');
  });

  it('extracts from /company/ URLs', () => {
    expect(parseLinkedInPublicIdentifier('https://linkedin.com/company/rho-co/')).toBe('rho-co');
  });
});
