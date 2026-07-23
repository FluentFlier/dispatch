import { describe, expect, it } from 'vitest';
import { findNewConnectedAccount } from '@/app/(dashboard)/onboarding/social-connection';

const linkedin = {
  platform: 'linkedin',
  account_name: 'Bhavana Kannan',
  unipile_account_id: 'li-new',
};

describe('onboarding social connection confirmation', () => {
  it('recognizes the first account for a first-time connection', () => {
    expect(findNewConnectedAccount([linkedin], new Set())).toEqual(linkedin);
  });

  it('does not report an existing account as a newly completed reconnect', () => {
    expect(findNewConnectedAccount([linkedin], new Set(['li-new']))).toBeNull();
  });

  it('finds the newly added account when another account was already connected', () => {
    const twitter = {
      platform: 'twitter',
      account_name: '@bhavana',
      unipile_account_id: 'x-old',
    };
    expect(findNewConnectedAccount([twitter, linkedin], new Set(['x-old']))).toEqual(linkedin);
  });

  it('falls back to a visible account when browser storage is unavailable', () => {
    expect(findNewConnectedAccount([linkedin], null)).toEqual(linkedin);
  });
});
