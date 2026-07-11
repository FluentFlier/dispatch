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
}

const PROSE_TYPES = new Set(['post', 'reply', 'comment']);
const isProse = (ctx: CheckContext) => PROSE_TYPES.has(ctx.contentType);
const isPost = (ctx: CheckContext) => ctx.contentType === 'post';

const pass = (id: string, severity: CheckSeverity): CheckResult => ({ id, severity, pass: true });
const fail = (id: string, severity: CheckSeverity, evidence: string, fixHint: string): CheckResult =>
  ({ id, severity, pass: false, evidence: evidence.slice(0, 160), fixHint });

// --- em_dash -------------------------------------------------------------
const emDash: Check = {
  id: 'em_dash', severity: 'hard',
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

// --- mention_integrity ---------------------------------------------------
const mentionIntegrity: Check = {
  id: 'mention_integrity', severity: 'hard',
  appliesTo: isProse,
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

const fabricatedSpecifics: Check = {
  id: 'fabricated_specifics', severity: 'hard',
  appliesTo: isProse,
  test: (text, ctx) => {
    const allowed = [ctx.userPrompt, ctx.sourceContext ?? '', ctx.profile?.display_name ?? '',
      (ctx.mentions ?? []).join(' ')].join(' ').toLowerCase();
    const allowedDigits = new Set(
      Array.from(allowed.matchAll(/[$]?\d[\d,.]*[%km]?/gi)).map((m) => normalizeNumber(m[0])),
    );

    for (const m of Array.from(text.matchAll(/[$]?\d[\d,.]*[%km]?/gi))) {
      const norm = normalizeNumber(m[0]);
      if (NUM_WHITELIST.has(norm)) continue;
      if (!allowedDigits.has(norm) && !allowed.includes(norm)) {
        return fail('fabricated_specifics', 'hard', m[0],
          `Remove or replace the number "${m[0]}" - it does not appear in the request or provided context. Never invent statistics.`);
      }
    }

    // Proper nouns: 2+ consecutive Capitalized words, skipping sentence starts.
    for (const m of Array.from(text.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]+(?: [A-Z][a-z]+)+)\b/gm))) {
      const nameLower = m[1].toLowerCase();
      const words = nameLower.split(' ');
      if (words.every((w) => WORD_WHITELIST.has(w))) continue;
      if (!allowed.includes(nameLower)) {
        return fail('fabricated_specifics', 'hard', m[1],
          `Remove "${m[1]}" - this name does not appear in the request or provided context. Never invent people or companies.`);
      }
    }
    return pass('fabricated_specifics', 'hard');
  },
};

export const CHECKS: Check[] = [emDash, markdown, platformLength, mentionIntegrity, paragraphShape, fabricatedSpecifics];

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
