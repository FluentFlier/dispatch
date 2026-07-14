import { describe, expect, it } from 'vitest';
import {
  busyActionFor,
  leadButtonBusy,
  signalButtonBusy,
  type LeadBusy,
  type LeadDetailAction,
} from '@/lib/leads/busy';

/**
 * WS1.1 - Decouple the Plan-outreach and Draft-message buttons.
 *
 * Root cause of the shipped bug: a single `busyId` was passed as one `busy`
 * prop and bound to `loading=` on every button, so clicking Plan outreach
 * skeletoned Draft message (and vice versa). The fix tracks one `{ id, action }`
 * and derives per-button flags. These tests assert that derivation in isolation
 * (the repo's test env is node, so we test the pure logic the components use).
 */

const LEAD_A = 'lead-a';
const LEAD_B = 'lead-b';

describe('WS1.1 busyActionFor: only the acting lead is busy', () => {
  it('returns null when nothing is in flight', () => {
    expect(busyActionFor(null, LEAD_A)).toBeNull();
  });

  it('returns the action for the matching lead only', () => {
    const busy: LeadBusy = { id: LEAD_A, action: 'plan' };
    expect(busyActionFor(busy, LEAD_A)).toBe('plan');
    // A different lead is unaffected.
    expect(busyActionFor(busy, LEAD_B)).toBeNull();
  });
});

describe('WS1.1 leadButtonBusy: Plan and Draft spinners are independent', () => {
  it('planning spins ONLY Plan; Draft stays clickable', () => {
    const flags = leadButtonBusy(
      busyActionFor({ id: LEAD_A, action: 'plan' }, LEAD_A) as LeadDetailAction | null,
    );
    expect(flags.planBusy).toBe(true);
    // The core regression assertion: drafting is NOT skeletoned by planning.
    expect(flags.draftBusy).toBe(false);
    expect(flags.approveBusy).toBe(false);
    expect(flags.resolveBusy).toBe(false);
  });

  it('drafting spins ONLY Draft/Regenerate; Plan stays clickable', () => {
    const flags = leadButtonBusy(
      busyActionFor({ id: LEAD_A, action: 'draft' }, LEAD_A) as LeadDetailAction | null,
    );
    expect(flags.draftBusy).toBe(true);
    expect(flags.planBusy).toBe(false);
  });

  it('each action maps to exactly one spinner flag', () => {
    const cases: Array<[Parameters<typeof leadButtonBusy>[0], keyof ReturnType<typeof leadButtonBusy>]> = [
      ['draft', 'draftBusy'],
      ['plan', 'planBusy'],
      ['approve', 'approveBusy'],
      ['resolve', 'resolveBusy'],
      ['followup', 'followupBusy'],
      ['check', 'checkBusy'],
    ];
    for (const [action, expectedFlag] of cases) {
      const flags = leadButtonBusy(action);
      const trueFlags = Object.entries(flags)
        .filter(([k, v]) => v === true && k !== 'anyBusy')
        .map(([k]) => k);
      expect(trueFlags).toEqual([expectedFlag]);
    }
  });

  it('anyBusy gates send/email while any action runs, and is false when idle', () => {
    expect(leadButtonBusy(null).anyBusy).toBe(false);
    expect(leadButtonBusy('plan').anyBusy).toBe(true);
    expect(leadButtonBusy('email').anyBusy).toBe(true);
  });
});

describe('WS1.1 signalButtonBusy: Draft and Send spinners are independent', () => {
  it('drafting a signal does not spin Send', () => {
    const flags = signalButtonBusy('draft');
    expect(flags.draftBusy).toBe(true);
    expect(flags.sendBusy).toBe(false);
    expect(flags.anyBusy).toBe(true);
  });

  it('sending a signal does not spin Draft/Regenerate', () => {
    const flags = signalButtonBusy('send');
    expect(flags.sendBusy).toBe(true);
    expect(flags.draftBusy).toBe(false);
  });

  it('idle signal panel has no spinners', () => {
    expect(signalButtonBusy(null)).toEqual({ draftBusy: false, sendBusy: false, anyBusy: false });
  });
});
