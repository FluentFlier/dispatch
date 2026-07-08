/**
 * Phase: Leads quality fixes - verified badge decision
 *
 * LeadDetail shows a "Verified" badge next to the founder's LinkedIn link when
 * the contact was confirmed via Unipile, a subtle "Unverified" hint when there
 * is a URL that has not been confirmed, and nothing when there is no URL. The
 * repo's vitest setup cannot render the .tsx component, so the badge decision
 * lives in a pure helper (linkedInBadgeState) that the component consumes; this
 * locks in that decision so a stale URL is never presented as verified.
 */
import { describe, it, expect } from 'vitest';
import { linkedInBadgeState } from '@/lib/leads/verified-badge';

describe('Phase: Leads quality fixes - linkedInBadgeState', () => {
  it('returns "verified" when there is a URL and linkedin_verified is true', () => {
    expect(
      linkedInBadgeState({ linkedin_url: 'https://linkedin.com/in/ava', linkedin_verified: true }),
    ).toBe('verified');
  });

  it('returns "unverified" when there is a URL but linkedin_verified is false', () => {
    expect(
      linkedInBadgeState({ linkedin_url: 'https://linkedin.com/in/ava', linkedin_verified: false }),
    ).toBe('unverified');
  });

  it('treats a missing linkedin_verified flag as unverified (default false)', () => {
    expect(linkedInBadgeState({ linkedin_url: 'https://linkedin.com/in/ava' })).toBe('unverified');
  });

  it('returns null (no badge) when there is no LinkedIn URL to verify', () => {
    expect(linkedInBadgeState({ linkedin_url: null, linkedin_verified: true })).toBeNull();
    expect(linkedInBadgeState({ linkedin_url: '   ', linkedin_verified: false })).toBeNull();
  });

  it('returns null for a missing contact', () => {
    expect(linkedInBadgeState(null)).toBeNull();
    expect(linkedInBadgeState(undefined)).toBeNull();
  });
});
