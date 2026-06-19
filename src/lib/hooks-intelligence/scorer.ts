/**
 * Hook Scorer + Lightweight Ranker (RL-style)
 * 
 * Scores hooks for "conversion potential" using multiple signals.
 * Designed to improve over time with more data and feedback (the RL part).
 * 
 * This is the brain that makes Content OS's hooks "phenomenal".
 */

import type { ExtractedHook, HookScore, HookVertical } from './types';

export function scoreHook(hook: ExtractedHook, vertical?: HookVertical): HookScore {
  const text = hook.text.toLowerCase();
  const len = hook.text.length;

  // 1. Specificity (numbers, names, concrete details)
  const hasNumber = /\d+/.test(hook.text);
  const hasName = /@[a-z0-9_]+/.test(hook.text) || /[A-Z][a-z]+ [A-Z]/.test(hook.text);
  const specificity = Math.min(10, (hasNumber ? 4 : 0) + (hasName ? 3 : 0) + (text.includes('exactly') || text.includes('specific') ? 2 : 0) + 1);

  // 2. Results language (strong conversion signal)
  const resultsWords = ['made', 'revenue', '$', 'sold', 'customers', 'clients', 'grew', 'from .* to', 'crossed'];
  const resultsLanguage = Math.min(10, resultsWords.filter(w => text.includes(w)).length * 2 + (hasNumber ? 2 : 0));

  // 3. Emotional / Curiosity trigger
  const emotionalTriggers = ['??', '!', 'randomly', 'discovered', 'truth', 'uncomfortable', 'secret', 'never', 'everyone', 'nobody'];
  const emotionalTrigger = Math.min(10, emotionalTriggers.filter(t => text.includes(t)).length * 1.5 + (len < 80 ? 2 : 0));

  // 4. CTA / Implication strength
  const ctaWords = ['here', 'below', 'link', 'read', 'try', 'do this', 'the', 'how to'];
  const ctaStrength = Math.min(10, ctaWords.filter(w => text.includes(w)).length + (text.includes('thread') ? 2 : 0));

  // 5. Length (platform optimized - X loves 40-280 chars for hooks)
  const lengthScore = len >= 40 && len <= 140 ? 9 : len > 140 && len < 280 ? 7 : 5;

  // 6. Vertical fit (if provided)
  let verticalFit = 5;
  if (vertical && hook.verticals?.includes(vertical)) verticalFit = 9;

  // 7. Engagement proxy (if we have real data from scrape)
  const engagementProxy = hook.engagement 
    ? Math.min(10, ((hook.engagement.replies || 0) + (hook.engagement.likes || 0) * 0.1) / 50) 
    : 5;

  const total = Math.round(
    (specificity * 1.2 + 
     resultsLanguage * 1.5 + 
     emotionalTrigger * 1.1 + 
     ctaStrength * 1.0 + 
     lengthScore * 0.8 + 
     verticalFit * 0.9 + 
     engagementProxy * 1.0) / 7.5 * 10   // normalize to ~100 scale later
  );

  return {
    hookId: hook.id,
    specificity,
    resultsLanguage,
    emotionalTrigger,
    ctaStrength,
    lengthScore,
    verticalFit,
    engagementProxy,
    total: Math.min(100, total),
    confidence: hook.engagement ? 0.85 : 0.6,
  };
}

/**
 * Rank and return the best hooks for a given context.
 * This is where the "learned" ranking happens.
 */
export function rankHooks(
  hooks: ExtractedHook[], 
  vertical?: HookVertical, 
  limit = 12
): Array<ExtractedHook & { score: HookScore }> {
  const scored = hooks.map(h => ({
    ...h,
    score: scoreHook(h, vertical),
  }));

  return scored
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit);
}

/**
 * Simple reinforcement update (the RL part).
 * Call this when a hook performs well in the real world (high engagement, sales, etc.).
 */
export function reinforceHook(
  currentScore: HookScore, 
  performanceDelta: number // positive = good performance
): HookScore {
  const boost = Math.min(5, Math.max(-3, performanceDelta * 0.8));
  return {
    ...currentScore,
    total: Math.min(100, Math.max(0, currentScore.total + boost)),
    confidence: Math.min(0.95, currentScore.confidence + 0.05),
  };
}
