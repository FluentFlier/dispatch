import { describe, it, expect } from 'vitest';
import { resolveStep, isStepKey, STEP_ORDER } from '@/app/(dashboard)/onboarding/resolve-step';

describe('resolveStep', () => {
  it('sends a brand new user to the first step', () => {
    expect(resolveStep({ connectedCount: 0, hasBaseline: false }, null)).toBe('you');
  });

  it('sends a user with a connected account to connect', () => {
    expect(resolveStep({ connectedCount: 1, hasBaseline: false }, null)).toBe('connect');
  });

  it('sends a user with a stored baseline straight to profile', () => {
    expect(resolveStep({ connectedCount: 1, hasBaseline: true }, null)).toBe('profile');
  });

  it('honours an explicit step so Back navigation is never overridden', () => {
    expect(resolveStep({ connectedCount: 1, hasBaseline: true }, 'you')).toBe('you');
    expect(resolveStep({ connectedCount: 0, hasBaseline: false }, 'connect')).toBe('connect');
  });

  it('ignores an unknown requested step', () => {
    expect(resolveStep({ connectedCount: 0, hasBaseline: false }, 'bogus')).toBe('you');
  });
});

describe('isStepKey', () => {
  it('accepts every ordered step and rejects anything else', () => {
    for (const key of STEP_ORDER) expect(isStepKey(key)).toBe(true);
    expect(isStepKey('nope')).toBe(false);
    expect(isStepKey(null)).toBe(false);
  });
});
