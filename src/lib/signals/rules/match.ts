import type {
  ClassifiedSignal,
  OutreachChannel,
  SignalActionMode,
  SignalPlatform,
  SignalRuleRow,
  SignalSourceType,
} from '@/lib/signals/types';

/** Channel strings the pipeline understands (rule.channels may also hold 'dashboard'). */
const VALID_CHANNELS: readonly OutreachChannel[] = [
  'linkedin_connect',
  'linkedin_dm',
  'x_dm',
  'gmail',
  'copy',
];

/** Shape stored in signal_rules.conditions (jsonb). All fields optional; empty = match-any. */
export interface RuleConditions {
  signal_types?: string[];
  source_types?: string[];
  keywords?: string[];
}

export interface RuleMatchContext {
  platform: SignalPlatform;
  sourceType?: SignalSourceType;
}

export interface RuleResolution {
  /**
   * The effective action mode for this signal:
   *   - null  → no enabled rules configured; caller falls back to the workspace default.
   *   - a mode → a rule matched (its action_mode), OR rules exist but none matched
   *     (then 'notify_only' — rules act as an action allowlist).
   */
  actionMode: SignalActionMode | null;
  channels: OutreachChannel[];
  matchedRuleId?: string;
  matchedRuleName?: string;
}

function mapChannels(raw: unknown): OutreachChannel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is OutreachChannel => typeof c === 'string' && (VALID_CHANNELS as readonly string[]).includes(c),
  );
}

function ruleMatches(
  rule: SignalRuleRow,
  ctx: RuleMatchContext,
  classified: ClassifiedSignal,
): boolean {
  if (rule.platform && rule.platform !== 'any' && rule.platform !== ctx.platform) return false;

  const cond = (rule.conditions ?? {}) as RuleConditions;

  if (Array.isArray(cond.signal_types) && cond.signal_types.length > 0) {
    if (!cond.signal_types.includes(classified.signalType)) return false;
  }

  if (Array.isArray(cond.source_types) && cond.source_types.length > 0) {
    if (!ctx.sourceType || !cond.source_types.includes(ctx.sourceType)) return false;
  }

  if (Array.isArray(cond.keywords) && cond.keywords.length > 0) {
    const matched = classified.matchedKeywords.map((k) => k.toLowerCase());
    const hit = cond.keywords.some((kw) => {
      const needle = kw.toLowerCase();
      return matched.some((m) => m.includes(needle));
    });
    if (!hit) return false;
  }

  return true;
}

/**
 * Resolves the action for a classified signal from a workspace's trigger rules.
 * Rules are an opt-in refinement over the workspace default:
 *   - No enabled rules → { actionMode: null } → caller uses the workspace default intent.
 *   - Rules exist, first enabled match wins → that rule's action_mode + channels.
 *   - Rules exist, none match → { actionMode: 'notify_only' } (allowlist semantics).
 * Rules must be passed in created_at order for deterministic first-match behavior.
 */
export function resolveRuleAction(
  rules: SignalRuleRow[],
  ctx: RuleMatchContext,
  classified: ClassifiedSignal,
): RuleResolution {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return { actionMode: null, channels: [] };

  for (const rule of enabled) {
    if (ruleMatches(rule, ctx, classified)) {
      return {
        actionMode: rule.action_mode,
        channels: mapChannels(rule.channels),
        matchedRuleId: rule.id,
        matchedRuleName: rule.name,
      };
    }
  }

  return { actionMode: 'notify_only', channels: [] };
}
