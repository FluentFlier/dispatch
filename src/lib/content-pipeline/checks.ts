/**
 * Deterministic check registry - single source of truth for editorial
 * quality rules. Pure functions, zero LLM calls, <5ms total.
 * Phase 1: measurement only (evals). Phase 3: pipeline enforcement +
 * styleRulesFromChecks replaces hand-written prompt rule blocks.
 *
 * hard = gate (failure triggers revise/escalation in Phase 3, never ships silently)
 * soft = signal (logged, NEVER blocks on its own - over-aggressive output
 *        guards are the top documented production failure of guardrail stacks)
 */

import { findSlopMatches } from './slop-lexicon';

export type CheckSeverity = 'hard' | 'soft';

export interface CheckContext {
  platform?: string;
  contentType: string;
  sourceContext?: string;
  userPrompt: string;
  profile?: { display_name?: string } | null;
  mentions?: string[];
}

export interface CheckResult {
  id: string;
  severity: CheckSeverity;
  pass: boolean;
  evidence?: string;
  fixHint?: string;
}

export interface Check {
  id: string;
  severity: CheckSeverity;
  appliesTo?: (ctx: CheckContext) => boolean;
  test: (text: string, ctx: CheckContext) => CheckResult;
  /**
   * Optional prompt-rule text for this check, evaluated only when the check
   * applies to ctx. styleRulesFromChecks() below composes its output from
   * these functions so the enforced rule and the prompted rule can never
   * diverge again (the divergence class that caused the f3b5a5c bug).
   * Return undefined to contribute no line for this ctx.
   */
  ruleText?: (ctx: CheckContext) => string | undefined;
  /**
   * Optional prompt-emission gate consulted ONLY by styleRulesFromChecks
   * (defaults to appliesTo ?? isProse). Lets base-hygiene rules (markdown,
   * em dashes, slop vocabulary) reach non-prose text outputs like 'hooks'
   * and 'caption' prompts WITHOUT changing which content types runChecks
   * measures/enforces.
   */
  ruleAppliesTo?: (ctx: CheckContext) => boolean;
}

const PROSE_TYPES = new Set(['post', 'thread', 'reply', 'comment']);
const isProse = (ctx: CheckContext) => PROSE_TYPES.has(ctx.contentType);
const isPost = (ctx: CheckContext) => ctx.contentType === 'post';

// Every pipeline output is text a human will post somewhere - base hygiene
// (no markdown, no em dashes, no slop vocabulary) prompt-applies universally.
const anyTextOutput = () => true;

const pass = (id: string, severity: CheckSeverity): CheckResult => ({ id, severity, pass: true });
const fail = (id: string, severity: CheckSeverity, evidence: string, fixHint: string): CheckResult =>
  ({ id, severity, pass: false, evidence: evidence.slice(0, 160), fixHint });

// --- em_dash -------------------------------------------------------------
const emDash: Check = {
  id: 'em_dash', severity: 'hard',
  ruleAppliesTo: anyTextOutput,
  ruleText: () => 'No em dashes anywhere. Ever. Use a comma, period, or hyphen instead.',
  test: (text) => {
    const m = text.match(/[—–]/);
    return m
      ? fail('em_dash', 'hard', text.slice(Math.max(0, m.index! - 30), m.index! + 30),
          'Remove every em/en dash; use a comma, period, or hyphen instead.')
      : pass('em_dash', 'hard');
  },
};

// --- markdown ------------------------------------------------------------
const MD_PATTERNS: Array<[RegExp, string]> = [
  [/```/g, 'code fence'],
  [/\*\*[^*\n]+\*\*/g, 'bold'],
  [/(^|\n)#{1,6}[ \t]+\S/g, 'heading'],
  [/(^|\n)[ \t]*>[ \t]\S/g, 'blockquote'],
  [/__[^_\n]+__/g, 'underscore bold'],
];
const markdown: Check = {
  id: 'markdown', severity: 'hard',
  ruleAppliesTo: anyTextOutput,
  ruleText: () => 'Plain text only. No markdown, no **bold**, no # headers, no bullet asterisks.',
  test: (text) => {
    for (const [re, label] of MD_PATTERNS) {
      const m = text.match(re);
      if (m) return fail('markdown', 'hard', `${label}: ${m[0]}`,
        'Remove all markdown syntax; social platforms render it literally.');
    }
    return pass('markdown', 'hard');
  },
};

// --- platform_length -----------------------------------------------------
const LENGTH_BOUNDS: Record<string, { min: number; max: number }> = {
  twitter: { min: 30, max: 280 },
  linkedin: { min: 400, max: 3000 },
  threads: { min: 30, max: 500 },
  instagram: { min: 100, max: 2200 },
};
const platformLength: Check = {
  id: 'platform_length', severity: 'hard',
  appliesTo: (ctx) => isPost(ctx) && Boolean(ctx.platform && LENGTH_BOUNDS[ctx.platform]),
  ruleText: (ctx) => {
    const b = ctx.platform ? LENGTH_BOUNDS[ctx.platform] : undefined;
    return b ? `Length for ${ctx.platform}: between ${b.min} and ${b.max} characters.` : undefined;
  },
  test: (text, ctx) => {
    const b = LENGTH_BOUNDS[ctx.platform!];
    const len = text.length;
    if (len < b.min) return fail('platform_length', 'hard', `${len} chars < ${b.min}`,
      `Expand the post; ${ctx.platform} posts under ${b.min} characters read as throwaway.`);
    if (len > b.max) return fail('platform_length', 'hard', `${len} chars > ${b.max}`,
      `Cut the post to at most ${b.max} characters for ${ctx.platform}.`);
    return pass('platform_length', 'hard');
  },
};

// --- thread_shape ----------------------------------------------------------
// X/Twitter threads are tweet sequences separated by lines containing only
// --- (the format CONTENT_TYPE_HINTS.thread instructs). One idea per tweet,
// every tweet inside the platform limit. platform_length and paragraph_shape
// are post-only and never fight this check.
export function splitThread(text: string): string[] {
  return text.split(/\n\s*---\s*\n/).map((t) => t.trim()).filter(Boolean);
}

const THREAD_MIN_TWEETS = 3;
const THREAD_MAX_TWEETS = 12;
const TWEET_MAX_CHARS = 280;

const threadShape: Check = {
  id: 'thread_shape', severity: 'hard',
  appliesTo: (ctx) => ctx.contentType === 'thread',
  ruleText: () =>
    `Thread format: 5 to 9 tweets, each ${TWEET_MAX_CHARS} characters or fewer, one idea per tweet, separated by a line containing only ---. First tweet is the hook; last tweet lands the takeaway.`,
  test: (text) => {
    const tweets = splitThread(text);
    if (tweets.length < THREAD_MIN_TWEETS)
      return fail('thread_shape', 'hard', `${tweets.length} tweet(s) found`,
        `Split the content into at least ${THREAD_MIN_TWEETS} tweets separated by lines containing only ---.`);
    if (tweets.length > THREAD_MAX_TWEETS)
      return fail('thread_shape', 'hard', `${tweets.length} tweets`,
        `Cut the thread to at most ${THREAD_MAX_TWEETS} tweets; merge or drop the weakest ones.`);
    const over = tweets.findIndex((t) => t.length > TWEET_MAX_CHARS);
    if (over >= 0)
      return fail('thread_shape', 'hard', `tweet ${over + 1} is ${tweets[over].length} chars`,
        `Shorten tweet ${over + 1} to ${TWEET_MAX_CHARS} characters or fewer; move the overflow into the next tweet.`);
    return pass('thread_shape', 'hard');
  },
};

// --- mention_integrity ---------------------------------------------------
const mentionIntegrity: Check = {
  id: 'mention_integrity', severity: 'hard',
  appliesTo: isProse,
  ruleText: (ctx) =>
    ctx.mentions?.length
      ? `Include exactly these @mentions naturally, and no others: ${ctx.mentions.map((m) => (m.startsWith('@') ? m : `@${m}`)).join(', ')}.`
      : undefined,
  test: (text, ctx) => {
    const requested = (ctx.mentions ?? []).map((m) => m.replace(/^@+/, '').toLowerCase());
    const lower = text.toLowerCase();
    for (const h of requested) {
      const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`@${escaped}(?![a-z0-9_-])(?!\\.[a-z0-9._-])`, 'i').test(lower)) {
        return fail('mention_integrity', 'hard', `missing @${h}`,
          `Include the requested mention @${h} naturally in the post.`);
      }
    }
    const inText = Array.from(text.matchAll(/(?<=^|[\s(["'])@([a-z0-9_][a-z0-9._-]{1,30})/gi)).map((m) => m[1].replace(/\.+$/, '').toLowerCase());
    const allowedSources = `${ctx.userPrompt} ${ctx.sourceContext ?? ''}`.toLowerCase();
    for (const h of inText) {
      if (!requested.includes(h) && !allowedSources.includes(h)) {
        return fail('mention_integrity', 'hard', `invented @${h}`,
          `Remove @${h}; only mention accounts the request or context named.`);
      }
    }
    return pass('mention_integrity', 'hard');
  },
};

// --- paragraph_shape -------------------------------------------------------
// Mirrors the intent of finalize.ts enforceParagraphFloor but as a DETECTOR:
// records whether the raw draft violated the floor (the auto-fix stays where
// it is; Phase 3 uses this signal for events/revision).
const sentenceCount = (p: string) =>
  (p.match(/[.!?](?=\s|["')\]]*(?:\s|$))/g) || []).length || 1;

const paragraphShape: Check = {
  id: 'paragraph_shape', severity: 'hard',
  appliesTo: isPost,
  ruleText: () =>
    'Group sentences into real paragraphs of 2-4 sentences each. Never a run of single-sentence paragraphs; only the opening hook and the final line may stand alone. Do not treat structural labels like Hook/Setup/Story/Insight/CTA as cues for one-sentence paragraphs; merge those beats into flowing prose.',
  test: (text) => {
    const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (paras.length <= 3) return pass('paragraph_shape', 'hard');
    const middle = paras.slice(1, -1);
    let run = 0;
    for (const p of middle) {
      run = sentenceCount(p) === 1 ? run + 1 : 0;
      if (run >= 3) {
        return fail('paragraph_shape', 'hard', p,
          'Merge consecutive one-sentence paragraphs into flowing 2-4 sentence paragraphs (hook and closing line may stand alone).');
      }
    }
    return pass('paragraph_shape', 'hard');
  },
};

// --- fabricated_specifics ---------------------------------------------------
const NUM_WHITELIST = new Set(['1', '2', '3', '4', '5', '10', '100']);
const WORD_WHITELIST = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'linkedin', 'twitter', 'instagram', 'threads', 'youtube', 'tiktok', 'google', 'ai',
]);

function normalizeNumber(raw: string): string {
  return raw.replace(/[,$%]/g, '').replace(/[km]$/i, '');
}

// Idioms that read as numbers but aren't statistics - strip before number scan.
const IDIOM_RES = [/\b24\/7\b/gi, /\b9\s?-?\s?to\s?-?\s?5\b/gi];

// Bare 4-digit token (no $, comma, decimal, %, k/m suffix) in a plausible calendar range.
function isCalendarYear(raw: string): boolean {
  if (!/^\d{4}$/.test(raw)) return false;
  const year = Number(raw);
  return year >= 1900 && year <= 2099;
}

// Words that legitimately open a sentence with capitalization and should not,
// by themselves, turn an ordinary sentence-opening bigram into a flagged
// "proper noun" (e.g. "Every Monday", "This Tuesday", "Next Friday").
const SENTENCE_STARTER_WHITELIST = new Set([
  'this', 'that', 'these', 'those', 'every', 'each', 'next', 'last', 'good',
  'happy', 'some', 'many', 'most', 'all', 'our', 'your', 'my', 'his', 'her',
  'their', 'one', 'another', 'the',
]);

const fabricatedSpecifics: Check = {
  id: 'fabricated_specifics', severity: 'hard',
  appliesTo: isProse,
  ruleText: () =>
    'Never invent a specific number, statistic, name, company, test, or personal anecdote that was not given in the prompt or context. If a beat has no real fact, write honest opinion or analysis instead.',
  test: (text, ctx) => {
    const allowed = [ctx.userPrompt, ctx.sourceContext ?? '', ctx.profile?.display_name ?? '',
      (ctx.mentions ?? []).join(' ')].join(' ').toLowerCase();
    const allowedDigits = new Set(
      Array.from(allowed.matchAll(/[$]?\d[\d,.]*[%km]?/gi)).map((m) => normalizeNumber(m[0].replace(/[.,]+$/, ''))),
    );

    const scanText = IDIOM_RES.reduce((t, re) => t.replace(re, ''), text);
    for (const m of Array.from(scanText.matchAll(/[$]?\d[\d,.]*[%km]?/gi))) {
      const raw = m[0].replace(/[.,]+$/, ''); // sentence punctuation is not part of the number
      const norm = normalizeNumber(raw);
      if (NUM_WHITELIST.has(norm) || isCalendarYear(raw)) continue;
      if (!allowedDigits.has(norm) && !allowed.includes(norm)) {
        return fail('fabricated_specifics', 'hard', raw,
          `Remove or replace the number "${raw}" - it does not appear in the request or provided context. Never invent statistics.`);
      }
    }

    // Proper nouns: 2+ consecutive Capitalized words. Previously any run
    // beginning exactly at a sentence/line start was skipped outright
    // (ambiguous capitalization), which meant a fabricated name used as its
    // OWN opening sentence ("Sundar Pichai even called...") went undetected
    // (Phase 1 session note - accepted fail-open, Phase 3 must close it).
    // Fix: drop the position-based exclusion. Starter words excuse only
    // THEMSELVES, never the rest of the run: strip leading whitelisted
    // starters ("Every Monday" -> "Monday", "The National Business Research
    // Institute" -> "National Business Research Institute", the D.1 prod
    // fabrication) and re-check the remainder. A remainder of 2+ capitalized
    // words is a real proper-noun signal wherever it sits in the sentence;
    // a 1-word remainder stays unchecked (single-word names too ambiguous).
    // Word atom allows interior caps ("McKinsey", "LinkedIn"), not just Xxxx.
    for (const m of Array.from(text.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)*(?: [A-Z][a-z]+(?:[A-Z][a-z]+)*)+)\b/gm))) {
      const words = m[1].toLowerCase().split(' ');
      let start = 0;
      while (start < words.length && SENTENCE_STARTER_WHITELIST.has(words[start])) start++;
      const rest = words.slice(start);
      if (rest.length < 2) continue;
      if (rest.every((w) => WORD_WHITELIST.has(w))) continue;
      if (!allowed.includes(rest.join(' '))) {
        const evidence = m[1].split(' ').slice(start).join(' ');
        return fail('fabricated_specifics', 'hard', evidence,
          `Remove "${evidence}" - this name does not appear in the request or provided context. Never invent people or companies.`);
      }
    }
    return pass('fabricated_specifics', 'hard');
  },
};

// --- slop_phrases (soft) ----------------------------------------------------
const slopPhrases: Check = {
  id: 'slop_phrases', severity: 'soft',
  ruleAppliesTo: anyTextOutput,
  ruleText: () =>
    'No corporate speak, no throat-clearing openers ("in today\'s world", "let\'s dive in"), no AI-tell vocabulary (delve, tapestry, leverage, game-changer, ever-evolving).',
  test: (text) => {
    const hits = findSlopMatches(text);
    return hits.length === 0
      ? pass('slop_phrases', 'soft')
      : fail('slop_phrases', 'soft', hits.slice(0, 5).join(', '),
          `Replace AI-tell vocabulary (${hits.slice(0, 3).join(', ')}) with plain words a person would actually type.`);
  },
};

// --- contrast_tell (soft) -----------------------------------------------------
const CONTRAST_RE = /(it'?s|this is(n'?t)?|that'?s) not (just )?(about )?[^.!?\n]{2,60}[,;.]? ?(it|this|that)'?s? (about )?/i;
const contrastTell: Check = {
  id: 'contrast_tell', severity: 'soft',
  test: (text) => {
    const m = text.match(CONTRAST_RE);
    return m ? fail('contrast_tell', 'soft', m[0], 'Rewrite the "not X, it\'s Y" construction; state the point directly.')
             : pass('contrast_tell', 'soft');
  },
};

// --- burstiness (soft) --------------------------------------------------------
const burstiness: Check = {
  id: 'burstiness', severity: 'soft',
  appliesTo: isPost,
  test: (text) => {
    const sentences = text.split(/[.!?]+\s/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (sentences.length < 4) return pass('burstiness', 'soft');
    const lens = sentences.map((s) => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    // Brief specified `sd < 4`, but its own BASE fixture (natural prose) measures
    // sd ~= 2.24 - sentence splitting is correct (8 sentences either fixture),
    // the threshold was simply miscalibrated against the brief's own pass case.
    // 2 is the minimal correct cut: uniform fixture sd = 0 still fails, BASE
    // (sd ~= 2.24) now passes, with margin on both sides.
    return sd < 2
      ? fail('burstiness', 'soft', `sentence-length stddev ${sd.toFixed(1)}`,
          'Vary sentence lengths: mix short punches with longer explanatory sentences.')
      : pass('burstiness', 'soft');
  },
};

// --- rule_of_three (soft) -------------------------------------------------------
const ruleOfThree: Check = {
  id: 'rule_of_three', severity: 'soft',
  test: (text) => {
    const triads = text.match(/\b\w+, \w+,? and \w+/gi) ?? [];
    return triads.length >= 2
      ? fail('rule_of_three', 'soft', triads.slice(0, 2).join(' | '),
          'Break up the perfectly balanced three-item lists; humans are lopsided.')
      : pass('rule_of_three', 'soft');
  },
};

// --- hook_present (soft) ----------------------------------------------------------
const GENERIC_OPENERS = [
  /^i('| a)m (so |very |really )?(excited|thrilled|happy|proud) to (announce|share)/i,
  /^i want(ed)? to (share|talk about)/i,
  /^(hello|hi) (everyone|all|folks|linkedin)/i,
  /^(today|recently),? i/i,
  /^in (today's|this) (world|post|article)/i,
];
const hookPresent: Check = {
  id: 'hook_present', severity: 'soft',
  appliesTo: isPost,
  test: (text) => {
    const first = (text.split('\n')[0] ?? '').trim();
    if (first.length > 140) return fail('hook_present', 'soft', first,
      'Tighten the first line to 140 characters or less; it must stop the scroll on its own.');
    for (const re of GENERIC_OPENERS) {
      if (re.test(first)) return fail('hook_present', 'soft', first,
        'Replace the generic opener with a specific, curiosity-creating first line.');
    }
    return pass('hook_present', 'soft');
  },
};

// --- bait_hook (hard) ---------------------------------------------------------------
// LinkedIn's March 2026 Authenticity Update suppresses these patterns
// regardless of account history. Generating them is negative-value.
//
// Recalibration (Phase 3): the original 4-consecutive-short-line rule
// false-positived on legitimate numbered listicles and short poems (Phase 1
// session note). Two changes close that gap: (1) list-marker lines
// ("1. ", "- ", "* ", "-> ") are structured content, not broetry, and reset
// the run; (2) the run threshold is 5, not 4, and the per-line word cap is
// tighter (broetry lines are typically 1-4 word fragments, not up to 7).
const BAIT_RES = [
  /\bagree\?\s*$/im,
  /\bcomment\s+["'“”]?\w+["'“”]?\s+(if|for|and|below)/i,
  /\brepost\s+if\b/i,
  /♻️/,
  /\b(like|comment) (this|below) (if|for)\b/i,
  /\bfollow me for more\b/i,
];
const LIST_MARKER_RE = /^(\d+[.)]|[-*•]|->)\s/;
const baitHook: Check = {
  id: 'bait_hook', severity: 'hard',
  appliesTo: isPost,
  ruleText: () =>
    'No engagement bait: never end the hook with "Agree?", never "Comment X for Y", never "Repost if", no one-line ladder formatting.',
  test: (text) => {
    for (const re of BAIT_RES) {
      const m = text.match(re);
      if (m) return fail('bait_hook', 'hard', m[0],
        'Remove the engagement-bait phrasing; LinkedIn suppresses bait patterns platform-wide.');
    }
    const lines = text.split('\n').map((l) => l.trim());
    let shortRun = 0;
    for (const l of lines) {
      if (l.length === 0) { shortRun = 0; continue; }
      if (LIST_MARKER_RE.test(l)) { shortRun = 0; continue; }
      const words = l.split(/\s+/).length;
      shortRun = words < 6 && /[a-z]/i.test(l) ? shortRun + 1 : 0;
      if (shortRun >= 5) return fail('bait_hook', 'hard', lines.slice(0, 5).join(' / '),
        'Merge the one-line ladder ("broetry") into real paragraphs.');
    }
    return pass('bait_hook', 'hard');
  },
};

export const CHECKS: Check[] = [
  emDash, markdown, platformLength, threadShape, mentionIntegrity, paragraphShape, fabricatedSpecifics,
  slopPhrases, contrastTell, burstiness, ruleOfThree, hookPresent, baitHook,
];

export function runChecks(text: string, ctx: CheckContext): CheckResult[] {
  const results: CheckResult[] = [];
  for (const c of CHECKS) {
    const applies = c.appliesTo ? c.appliesTo(ctx) : isProse(ctx);
    if (!applies) continue;
    results.push(c.test(text, ctx));
  }
  return results;
}

export function hardFailures(results: CheckResult[]): CheckResult[] {
  return results.filter((r) => r.severity === 'hard' && !r.pass);
}

// Two lines have no 1:1 automated check (nothing currently measures
// "concrete vs vague" or blank-line-only paragraph spacing) so they stay
// fixed text. Every OTHER line is pulled from CHECKS[].ruleText, so a future
// check change can never silently drift from the prompt again.
const FIXED_STYLE_LINES = {
  concreteDetails: 'Concrete details over vague claims. Talk directly to the reader, not about them.',
  blankLineSpacing: 'Use one blank line between paragraphs, never between individual sentences.',
};

/**
 * Generates the style-rules prompt block FROM the registry. Every hard check
 * with a ruleText contributes its rule line only when the check applies to
 * ctx (mirroring the exact gating runChecks itself uses), so prompt and
 * guard cannot diverge. Phase 3 wires this into BASE_SYSTEM/HOOK_SYSTEM
 * (index.ts) and HARD_RULES (compact.ts).
 */
export function styleRulesFromChecks(ctx: CheckContext): string {
  const byId = new Map(CHECKS.filter((c) => c.ruleText).map((c) => [c.id, c] as const));
  const ruleFor = (id: string): string | undefined => {
    const c = byId.get(id);
    if (!c) return undefined;
    const applies = (c.ruleAppliesTo ?? c.appliesTo ?? isProse)(ctx);
    return applies ? c.ruleText!(ctx) : undefined;
  };

  const lines = [
    'HARD RULES:',
    ruleFor('markdown'),
    ruleFor('em_dash'),
    FIXED_STYLE_LINES.concreteDetails,
    ruleFor('fabricated_specifics'),
    ruleFor('paragraph_shape'),
    // Paragraph spacing is prose layout advice - noise on hook lists/captions.
    isProse(ctx) ? FIXED_STYLE_LINES.blankLineSpacing : undefined,
    ruleFor('slop_phrases'),
    ruleFor('bait_hook'),
    ruleFor('platform_length'),
    ruleFor('thread_shape'),
    ruleFor('mention_integrity'),
  ].filter((l): l is string => Boolean(l));

  return [lines[0], ...lines.slice(1).map((l) => `- ${l}`)].join('\n');
}
