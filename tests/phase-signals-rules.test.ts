/**
 * Phase: Signals trigger-rule resolution
 *
 * resolveRuleAction turns a workspace's trigger rules into an effective action for
 * a classified signal. Rules are an allowlist: none configured -> workspace default
 * (null); configured but no match -> notify_only; a match -> that rule's mode.
 */
import { describe, it, expect } from 'vitest';
import { resolveRuleAction } from '@/lib/signals/rules/match';
import type { ClassifiedSignal, SignalRuleRow } from '@/lib/signals/types';

function rule(overrides: Partial<SignalRuleRow>): SignalRuleRow {
  return {
    id: overrides.id ?? 'r1',
    workspace_id: 'ws',
    name: overrides.name ?? 'Rule',
    platform: overrides.platform ?? 'any',
    conditions: overrides.conditions ?? {},
    action_mode: overrides.action_mode ?? 'notify_and_draft',
    channels: overrides.channels ?? ['dashboard'],
    enabled: overrides.enabled ?? true,
  };
}

function signal(overrides: Partial<ClassifiedSignal> = {}): ClassifiedSignal {
  return {
    signalType: overrides.signalType ?? 'accelerator_join',
    companyName: 'Acme',
    personName: 'Jane',
    acceleratorName: 'Y Combinator',
    batch: 'S24',
    signalSummary: 'joined YC S24',
    confidence: 0.9,
    dedupeKey: 'k',
    matchedKeywords: overrides.matchedKeywords ?? ['yc s24', 'batch'],
  };
}

const CTX = { platform: 'linkedin' as const, sourceType: 'person_profile' as const };

describe('Phase: Signals trigger-rule resolution', () => {
  it('no enabled rules -> null (use workspace default)', () => {
    expect(resolveRuleAction([], CTX, signal()).actionMode).toBeNull();
    expect(resolveRuleAction([rule({ enabled: false })], CTX, signal()).actionMode).toBeNull();
  });

  it('matches by signal_type and returns action_mode + valid channels', () => {
    const r = rule({
      conditions: { signal_types: ['accelerator_join'] },
      action_mode: 'auto_send',
      channels: ['linkedin_connect', 'dashboard'],
    });
    const res = resolveRuleAction([r], CTX, signal({ signalType: 'accelerator_join' }));
    expect(res.actionMode).toBe('auto_send');
    // 'dashboard' is filtered out — only real outreach channels survive.
    expect(res.channels).toEqual(['linkedin_connect']);
    expect(res.matchedRuleName).toBe('Rule');
  });

  it('rules exist but none match -> notify_only (allowlist)', () => {
    const r = rule({ conditions: { signal_types: ['funding_round'] } });
    const res = resolveRuleAction([r], CTX, signal({ signalType: 'accelerator_join' }));
    expect(res.actionMode).toBe('notify_only');
  });

  it('platform mismatch is skipped', () => {
    const r = rule({ platform: 'x', conditions: { signal_types: ['accelerator_join'] } });
    expect(resolveRuleAction([r], CTX, signal()).actionMode).toBe('notify_only');
  });

  it("platform 'any' matches either platform", () => {
    const r = rule({ platform: 'any', action_mode: 'notify_and_draft' });
    expect(resolveRuleAction([r], CTX, signal()).actionMode).toBe('notify_and_draft');
  });

  it('source_types condition gates the match', () => {
    const r = rule({ conditions: { source_types: ['person_profile'] }, action_mode: 'auto_send' });
    expect(resolveRuleAction([r], CTX, signal()).actionMode).toBe('auto_send');
    const company = { platform: 'linkedin' as const, sourceType: 'company_page' as const };
    expect(resolveRuleAction([r], company, signal()).actionMode).toBe('notify_only');
  });

  it('keyword condition matches against classifier matchedKeywords', () => {
    const r = rule({ conditions: { keywords: ['S24'] }, action_mode: 'auto_send' });
    expect(resolveRuleAction([r], CTX, signal({ matchedKeywords: ['yc s24'] })).actionMode).toBe('auto_send');
    expect(resolveRuleAction([r], CTX, signal({ matchedKeywords: ['seed round'] })).actionMode).toBe('notify_only');
  });

  it('first matching enabled rule wins', () => {
    const first = rule({ id: 'a', name: 'First', conditions: {}, action_mode: 'notify_and_draft' });
    const second = rule({ id: 'b', name: 'Second', conditions: {}, action_mode: 'auto_send' });
    const res = resolveRuleAction([first, second], CTX, signal());
    expect(res.matchedRuleName).toBe('First');
    expect(res.actionMode).toBe('notify_and_draft');
  });
});
