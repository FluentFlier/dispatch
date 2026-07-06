import { describe, it, expect } from 'vitest';
import {
  displayNameFromAuthUser,
  isEmailDerivedDisplayName,
  resolveDisplayName,
} from '@/lib/user-display-name';

describe('user-display-name', () => {
  it('prefers OAuth profile name over email local-part', () => {
    expect(
      displayNameFromAuthUser({
        email: 'founder@tryada.app',
        profile: { name: 'Anirudh Manjesh' },
      }),
    ).toBe('Anirudh Manjesh');
  });

  it('does not use email local-part as display name', () => {
    expect(
      resolveDisplayName({ oauthName: null, fallback: 'Creator' }),
    ).toBe('Creator');
    expect(
      resolveDisplayName({
        oauthName: 'Ada Founder',
        socialAccountName: 'LinkedIn Name',
      }),
    ).toBe('LinkedIn Name');
  });

  it('detects email-derived placeholder names', () => {
    expect(isEmailDerivedDisplayName('founder', 'founder@tryada.app')).toBe(true);
    expect(isEmailDerivedDisplayName('Anirudh', 'founder@tryada.app')).toBe(false);
  });
});
