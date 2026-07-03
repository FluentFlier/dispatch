/**
 * Splits voice context so substance stages get facts/memory only,
 * while the voice stage gets full fingerprint + examples.
 */
export function substanceContextOnly(additions?: string): string | undefined {
  if (!additions?.trim()) return undefined;

  const sections = additions.split('\n\n');
  const kept = sections.filter((s) =>
    s.startsWith('USER CONTEXT:') ||
    s.startsWith('BACKGROUND FACTS') ||
    s.startsWith('CREATOR BRAIN') ||
    s.startsWith('SEMANTIC MEMORY') ||
    s.startsWith('UNUSED STORY BANK'),
  );

  return kept.length > 0 ? kept.join('\n\n') : undefined;
}
