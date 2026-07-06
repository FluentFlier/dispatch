/**
 * Enforces the LinkedIn connect-note character limit server-side. The LLM
 * prompt only *asks* for <= 300 chars (a soft instruction); models can and do
 * overrun it (observed 314/300 in QA), which disables the Approve action in
 * the UI since LinkedIn rejects connect notes over the limit. This is the
 * hard, deterministic backstop applied after generation so every saved draft
 * is guaranteed sendable regardless of what the model returns.
 *
 * Trimming avoids cutting mid-word or leaving a dangling connector/punctuation:
 * it prefers the last full sentence that fits, falling back to the last
 * whitespace boundary. No ellipsis is added, so the result always reads as a
 * complete (if shorter) message rather than a truncated one.
 */
export function enforceConnectLimit(text: string, limit = 300): string {
  if (text.length <= limit) return text;

  const window = text.slice(0, limit + 1);

  // Prefer trimming at the last sentence boundary at or before the limit so
  // the message still reads as a complete thought.
  let bestSentenceEnd = -1;
  for (const punct of ['.', '!', '?']) {
    const idx = window.lastIndexOf(punct);
    if (idx > bestSentenceEnd && idx < limit) bestSentenceEnd = idx;
  }
  if (bestSentenceEnd >= 0) {
    return text.slice(0, bestSentenceEnd + 1).trim();
  }

  // No sentence boundary available: fall back to the last whitespace
  // boundary before the limit so we never cut a word in half.
  const truncated = text.slice(0, limit);
  const lastSpace = truncated.lastIndexOf(' ');
  const cut = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;

  // Strip a trailing dangling connector/punctuation/space left by the cut
  // (e.g. "...swap notes and" or "...let's chat,").
  return cut.replace(/[\s,;:.!?-]+$/, '').replace(/\s+(and|or|but|so|to|a|an|the|with|for)$/i, '');
}
