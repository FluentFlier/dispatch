/**
 * Splits the voice context string (built by voice-context.ts ::
 * buildVoiceContextAdditions) into labeled sections so each pipeline stage can
 * see exactly the sections it should. Sections are delimited by KNOWN header
 * lines, never by blank lines - section bodies contain their own `\n\n`.
 */

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
  'RESEARCH NOTES',
  'PAST CONTENT YOU HAVE ALREADY PUBLISHED',
] as const;

// The subset the substance stages are allowed to see. EMAIL VOICE is withheld
// (it is a 1:1 register, not for public posts).
const SUBSTANCE_ALLOWED_HEADERS = [
  'USER CONTEXT:',
  'BACKGROUND FACTS',
  'CREATOR BRAIN',
  'SEMANTIC MEMORY',
  'UNUSED STORY BANK',
  'VOCABULARY FINGERPRINT:',
  'STRUCTURAL PATTERNS:',
  'VOICE EXAMPLES',
  'PERFORMANCE BASELINE:',
  'RESEARCH NOTES',
  'PAST CONTENT YOU HAVE ALREADY PUBLISHED',
] as const;

/**
 * The strongest voice-cloning signal: the creator's measured vocabulary,
 * structure, and real example posts. Consumed by the evaluator (judge against
 * the real voice), buildSystemPrompt (authoritative block), and compact mode.
 */
export const VOICE_EVIDENCE_HEADERS = [
  'VOCABULARY FINGERPRINT:',
  'STRUCTURAL PATTERNS:',
  'VOICE EXAMPLES',
] as const;

interface Section {
  header: string;
  content: string[];
}

function parseSections(additions: string): Section[] {
  const lines = additions.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (KNOWN_SECTION_HEADERS.some((h) => line.startsWith(h))) {
      current = { header: line, content: [line] };
      sections.push(current);
    } else if (current) {
      current.content.push(line);
    }
    // Lines before the first recognized header belong to no section - dropped.
  }
  return sections;
}

function joinSections(sections: Section[]): string | undefined {
  if (sections.length === 0) return undefined;
  return sections
    .map((s) => s.content.join('\n').replace(/\n+$/, ''))
    .join('\n\n');
}

function filterByHeaders(
  additions: string | undefined,
  headerPrefixes: readonly string[],
  mode: 'keep' | 'strip',
): string | undefined {
  if (!additions?.trim()) return undefined;
  const sections = parseSections(additions).filter((s) => {
    const matches = headerPrefixes.some((h) => s.header.startsWith(h));
    return mode === 'keep' ? matches : !matches;
  });
  return joinSections(sections);
}

/** Sections the substance stages (Base + Hook) may see. */
export function substanceContextOnly(additions?: string): string | undefined {
  return filterByHeaders(additions, SUBSTANCE_ALLOWED_HEADERS, 'keep');
}

/** Only the fingerprint + structural + example sections. */
export function voiceEvidenceOnly(additions?: string): string | undefined {
  return filterByHeaders(additions, VOICE_EVIDENCE_HEADERS, 'keep');
}

/** Everything EXCEPT the named sections. */
export function stripSections(
  additions: string | undefined,
  headerPrefixes: readonly string[],
): string | undefined {
  return filterByHeaders(additions, headerPrefixes, 'strip');
}
