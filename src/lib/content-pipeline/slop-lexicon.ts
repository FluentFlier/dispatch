/**
 * Slop lexicon - THE single source of truth for AI-tell vocabulary.
 * Structured entries (not bare regexes) so Phase 4 rot-review can retire
 * dead entries by hit-rate and attribute where each came from.
 * Phase 3 points humanizer + compact edit prompts at this file.
 */

export interface SlopEntry {
  pattern: string;        // word, phrase, or regex source
  isRegex?: boolean;      // true -> compile pattern as-is; false -> whole-word/phrase literal
  source: 'humanizer' | 'compact-edit' | 'community-2026';
  addedAt: string;        // YYYY-MM-DD
}

const D = '2026-07-11';

// Single words - matched with \b word boundaries, case-insensitive.
export const SLOP_WORDS: SlopEntry[] = [
  // Copied from humanizer.ts AI_SLOP_PATTERNS word bank (source: 'humanizer').
  ...[
    'delve', 'tapestry', 'leverage', 'foster', 'landscape', 'nuanced',
    'multifaceted', 'comprehensive', 'robust', 'holistic', 'pivotal',
    'crucial', 'paramount', 'innovative', 'transformative', 'utilize',
    'realm', 'underscore', 'testament', 'seamless', 'elevate', 'empower',
    'unlock', 'harness', 'navigate', 'cultivate', 'embark', 'profound',
  ].map((w) => ({ pattern: w, source: 'humanizer' as const, addedAt: D })),
  // compact.ts's buildCompactEditSystem word list (delve, tapestry, leverage,
  // foster, landscape, nuanced, multifaceted, comprehensive, robust, holistic,
  // pivotal, transformative, utilize, seamless, elevate, empower, unlock,
  // harness) is a strict subset of the humanizer bank above - no new words to
  // add from it; 'humanizer' wins per the dedup rule.
  // Community additions (source: 'community-2026') - 2025/26-generation tells:
  ...[
    'boast', 'vibrant', 'bustling', 'unleash',
    'revolutionize', 'supercharge', 'game-changer', 'gamechanger', 'synergy',
    'paradigm', 'unprecedented', 'meticulous', 'meticulously', 'intricate',
    'commendable', 'noteworthy', 'invaluable', 'indelible',
    'ever-evolving', 'fast-paced', 'cutting-edge', 'groundbreaking',
    'trailblazer', 'powerhouse', 'juggernaut', 'stark', 'poignant',
    'resonate', 'underscores', 'showcasing', 'spearhead',
    'facilitate', 'streamline', 'optimize', 'actionable', 'impactful',
    'learnings', 'journeyed',
  ].map((w) => ({ pattern: w, source: 'community-2026' as const, addedAt: D })),
];

// Multi-word phrases / structural patterns - phrase literals unless isRegex.
export const SLOP_PHRASES: SlopEntry[] = [
  // Copied from humanizer.ts AI_SLOP_PATTERNS phrase/structural regexes
  // (source: 'humanizer'). compact.ts's throat-clearing/filler list
  // ("in today's world", "it's worth noting", "in conclusion", "at the end
  // of the day") is already covered by these - no new compact-edit phrases.
  {
    pattern: "\\bin today'?s (?:fast-paced |digital |modern |competitive )?world\\b",
    isRegex: true,
    source: 'humanizer',
    addedAt: D,
  },
  {
    pattern: "\\bit'?s (?:worth|important) (?:noting|to note|mentioning)\\b",
    isRegex: true,
    source: 'humanizer',
    addedAt: D,
  },
  {
    pattern: '\\b(?:in conclusion|to sum up|in summary|ultimately,|at the end of the day)\\b',
    isRegex: true,
    source: 'humanizer',
    addedAt: D,
  },
  {
    pattern: "\\blet'?s (?:dive|unpack|explore|break (?:it|this) down)\\b",
    isRegex: true,
    source: 'humanizer',
    addedAt: D,
  },
  {
    pattern: '\\bnot only\\b[^.]*\\bbut also\\b',
    isRegex: true,
    source: 'humanizer',
    addedAt: D,
  },
  {
    pattern: "\\bwhether you'?re\\b",
    isRegex: true,
    source: 'humanizer',
    addedAt: D,
  },
  {
    pattern: '\\bgame[- ]chang(?:er|ing)\\b',
    isRegex: true,
    source: 'humanizer',
    addedAt: D,
  },
  // Community additions (source: 'community-2026'):
  ...[
    "in today's fast-paced world", 'in the ever-evolving landscape',
    'the world of', 'navigating the landscape', 'navigating the complexities',
    'take it to the next level', 'a wealth of', 'a plethora of',
    'the power of', 'unlock the potential', 'unlock your potential',
    'game changer', 'here to stay', 'the future of work',
    'i hope this finds you', 'buckle up', 'strap in',
    'without further ado', 'dive deep', 'deep dive into',
    'in a world where', 'gone are the days', 'the digital age',
    'look no further', 'said no one ever', 'plot twist:',
    'hot take:', 'unpopular opinion:', 'let that sink in',
    'read that again', 'agree to disagree',
  ].map((p) => ({ pattern: p, source: 'community-2026' as const, addedAt: D })),
  // Regex-form structural tells:
  { pattern: "it'?s not (just )?(about )?[^.!?\\n]{2,60}[,;.]? ?it'?s (about )?", isRegex: true, source: 'community-2026', addedAt: D },
  { pattern: "this isn'?t (just )?(about )?[^.!?\\n]{2,60}[,;.]? ?(it|this) is", isRegex: true, source: 'community-2026', addedAt: D },
];

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toRegex(e: SlopEntry): RegExp {
  if (e.isRegex) return new RegExp(e.pattern, 'gi');
  return new RegExp(`\\b${escapeLiteral(e.pattern)}\\b`, 'gi');
}

export function allSlopRegexes(): RegExp[] {
  return [...SLOP_WORDS, ...SLOP_PHRASES].map(toRegex);
}

/** Returns the matched slop strings (lowercased, deduped) found in text. */
export function findSlopMatches(text: string): string[] {
  const hits = new Set<string>();
  for (const e of [...SLOP_WORDS, ...SLOP_PHRASES]) {
    const m = text.match(toRegex(e));
    if (m) hits.add(e.pattern.toLowerCase());
  }
  return Array.from(hits);
}
