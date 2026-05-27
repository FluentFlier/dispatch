/**
 * High-converting hook patterns extracted via gstack browse + analysis
 * of top performers across indie maker, copywriting, thread systems,
 * and one-person business verticals (2025-2026).
 *
 * Use these explicitly in generation prompts for better engagement.
 */

export const HOOK_PATTERNS = {
  indieMaker: [
    "the best N [things] for [audience]:",
    "[Thing A] vs [Thing B] in [timeframe]",
    "Today I randomly discovered [very specific surprising fact]???",
    "I analyzed [large number] [items]. The patterns that actually matter:",
  ],

  directResponse: [
    "How I [specific impressive result] without [thing everyone assumes is required]",
    "The [tiny number] [asset] that made me $[amount] last [period]",
    "[Specific result] in [short time] using only [limited resources]",
  ],

  threadSystems: [
    "I studied [X] viral threads. Here are the [small number] hook formulas that actually work:",
    "This [number]-word hook got [impressive engagement metric]",
    "The '[Pattern Name]' hook (with real examples)",
  ],

  onePersonBusiness: [
    "Most people [common behavior]. Here's the version that actually compounds:",
    "I make $[amount]/month with [small number] products and [tiny team size]. The full system:",
    "The uncomfortable truth about [widely believed thing in the niche]:",
  ],

  visualDesign: [
    "[Powerful short statement] — visualized",
    "Before/after of [transformation] in one clean visual",
  ],
} as const;

export type HookVertical = keyof typeof HOOK_PATTERNS;

/**
 * Returns a random high-signal hook pattern for the given vertical.
 * Use inside buildSystemPrompt or generation calls.
 */
export function getHookPattern(vertical: HookVertical): string {
  const patterns = HOOK_PATTERNS[vertical];
  return patterns[Math.floor(Math.random() * patterns.length)];
}

/**
 * Full set of battle-tested hook openers (cross-palette).
 * Good for "give me 8 hook options" features.
 */
export const ALL_TOP_HOOKS = [
  "the best N people to follow in [topic]:",
  "How I [result] without [common requirement]",
  "[A] vs [B] in [year/timeframe]",
  "Today I randomly discovered [specific surprising thing]???",
  "I analyzed [large number] [artifacts]. Here are the patterns:",
  "Most people [behavior]. The better, calmer version:",
  "This one [post/email/offer/thing] made me $[amount] last month",
  "The uncomfortable truth about [popular belief]:",
] as const;

// Dynamic loading from the massive mined Hook Intelligence dataset (gstack-powered)
// This is the "phenomenal" part — agents get real, ranked, ever-growing hook examples
import { getBestHooksForContext } from '../hooks-intelligence';

export function getDynamicTopHooks(vertical?: any, limit = 15): string[] {
  try {
    const ranked = getBestHooksForContext(vertical, limit);
    if (ranked.length > 0) {
      return ranked.map((h: any) => h.text);
    }
  } catch {}
  return [...ALL_TOP_HOOKS];
}

