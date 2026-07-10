/**
 * Splits voice context for the substance stages (Base + Hook).
 *
 * These stages set the post's actual content, so they need both the factual
 * grounding (facts/memory/story bank/event specifics) AND the voice signal
 * (vocabulary fingerprint, structural patterns, voice examples). Drafting the
 * substance generic and only brushing voice on at Stage 4 averages toward
 * generic output, so the fingerprint + examples are fed here too.
 *
 * The Voice stage (Stage 4) still receives the FULL context string, so nothing
 * is lost there; this only widens what the earlier stages are allowed to see.
 */

// Every known section header emitted into `contextAdditions` (see
// voice-context.ts :: buildVoiceContextAdditions + the appended story-bank / L4
// blocks). Used to find true section boundaries. Order does not matter; matched
// by prefix on a line.
const KNOWN_SECTION_HEADERS = [
  'USER CONTEXT:',
  'BACKGROUND FACTS',
  'VOCABULARY FINGERPRINT:',
  'STRUCTURAL PATTERNS:',
  'VOICE EXAMPLES',
  'EMAIL VOICE',
  'CREATOR BRAIN',
  'SEMANTIC MEMORY',
  'UNUSED STORY BANK',
  'PERFORMANCE BASELINE:',
] as const;

// The subset the substance stages are allowed to see. EMAIL VOICE is withheld
// (it is a 1:1 register, not for public posts).
const SUBSTANCE_ALLOWED_HEADERS = [
  'USER CONTEXT:',
  'BACKGROUND FACTS',
  'CREATOR BRAIN',
  'SEMANTIC MEMORY',
  'UNUSED STORY BANK',
  // Voice signal — fed into substance so the draft sounds like the creator from
  // the first pass, not only after the late Stage 4 voice rewrite.
  'VOCABULARY FINGERPRINT:',
  'STRUCTURAL PATTERNS:',
  'VOICE EXAMPLES',
  // The user's own quality baseline should target the draft from the first pass,
  // not only nudge the late voice rewrite.
  'PERFORMANCE BASELINE:',
] as const;

function isSectionHeaderLine(line: string): boolean {
  return KNOWN_SECTION_HEADERS.some((h) => line.startsWith(h));
}

function isAllowedHeaderLine(line: string): boolean {
  return SUBSTANCE_ALLOWED_HEADERS.some((h) => line.startsWith(h));
}

export function substanceContextOnly(additions?: string): string | undefined {
  if (!additions?.trim()) return undefined;

  // Section by KNOWN HEADERS, not by blank-line boundaries. Section bodies (voice
  // examples, multi-paragraph facts) contain their own `\n\n`, so splitting on
  // `\n\n` over-fragments and drops everything after the first paragraph of each
  // section (break 27). Walk lines instead: a section runs from one header line to
  // the next, keeping the whole body intact.
  const lines = additions.split('\n');
  const sections: Array<{ header: string; content: string[] }> = [];
  let current: { header: string; content: string[] } | null = null;

  for (const line of lines) {
    if (isSectionHeaderLine(line)) {
      current = { header: line, content: [line] };
      sections.push(current);
    } else if (current) {
      current.content.push(line);
    }
    // Lines before the first recognized header (none in practice) are dropped —
    // they belong to no allow-listed section.
  }

  const kept = sections
    .filter((s) => isAllowedHeaderLine(s.header))
    // Trim trailing blank lines a section may have accumulated before the next
    // header so re-joining stays clean.
    .map((s) => s.content.join('\n').replace(/\n+$/, ''));

  return kept.length > 0 ? kept.join('\n\n') : undefined;
}
