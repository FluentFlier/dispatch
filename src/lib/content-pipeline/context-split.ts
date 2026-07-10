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
export function substanceContextOnly(additions?: string): string | undefined {
  if (!additions?.trim()) return undefined;

  const sections = additions.split('\n\n');
  const kept = sections.filter((s) =>
    s.startsWith('USER CONTEXT:') ||
    s.startsWith('BACKGROUND FACTS') ||
    s.startsWith('CREATOR BRAIN') ||
    s.startsWith('SEMANTIC MEMORY') ||
    s.startsWith('UNUSED STORY BANK') ||
    // Voice signal — fed into substance so the draft sounds like the creator
    // from the first pass, not only after the late Stage 4 voice rewrite.
    s.startsWith('VOCABULARY FINGERPRINT:') ||
    s.startsWith('STRUCTURAL PATTERNS:') ||
    s.startsWith('VOICE EXAMPLES'),
  );

  return kept.length > 0 ? kept.join('\n\n') : undefined;
}
