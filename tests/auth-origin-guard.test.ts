import { describe, it, expect } from 'vitest';
import { isAuthCapableOrigin } from '@/lib/auth-constants';

describe('isAuthCapableOrigin', () => {
  it('allows the canonical production origin', () => {
    expect(isAuthCapableOrigin('https://contentos.us')).toBe(true);
  });

  it('allows localhost dev on any port', () => {
    expect(isAuthCapableOrigin('http://localhost:3001')).toBe(true);
    expect(isAuthCapableOrigin('http://127.0.0.1:3000')).toBe(true);
  });

  it('rejects Vercel preview/deploy origins (the ones that recur in the allowlist error)', () => {
    expect(isAuthCapableOrigin('https://content-jshyfdpw6-adas-projects-3b0c5383.vercel.app')).toBe(false);
    expect(isAuthCapableOrigin('https://content-os-git-main-adas-projects-3b0c5383.vercel.app')).toBe(false);
  });

  it('rejects lookalike hosts that merely contain the domain string', () => {
    expect(isAuthCapableOrigin('https://contentos.us.evil.com')).toBe(false);
    expect(isAuthCapableOrigin('not-a-url')).toBe(false);
  });
});
