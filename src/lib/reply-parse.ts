/**
 * Parses LLM output for the Reply tool into one reply per comment.
 *
 * Order of preference:
 *  1. A well-formed JSON array of strings.
 *  2. A malformed array (no commas / smart quotes) — extract quoted strings.
 *  3. REPLY-marker blocks (REPLY 1: ...).
 *  4. Last resort: the whole text as a single reply.
 *
 * Always returns exactly one entry per comment so none are silently dropped.
 */
export function parseReplies(
  text: string,
  commentLines: string[],
): { comment: string; reply: string }[] {
  const toPairs = (replies: string[]) =>
    commentLines.map((c, i) => ({
      comment: c || `Comment ${i + 1}`,
      reply: replies[i] != null ? String(replies[i]).trim() : '(no reply generated)',
    }));

  const bracket = text.match(/\[[\s\S]*\]/);
  if (bracket) {
    // Preferred: a well-formed JSON array of reply strings.
    try {
      const arr = JSON.parse(bracket[0]);
      if (Array.isArray(arr) && arr.length > 0) return toPairs(arr.map((x) => String(x)));
    } catch {
      // Weaker models sometimes emit an array without commas (["a" "b" "c"]) or
      // with smart quotes — invalid JSON. Extract the quoted strings directly.
      const quoted = bracket[0].match(/[“”]((?:[^“”\\]|\\.)*)[“”]|"((?:[^"\\]|\\.)*)"/g);
      if (quoted && quoted.length > 0) {
        const cleaned = quoted
          .map((q) => q.replace(/^[“”"]|[“”"]$/g, '').trim())
          .filter(Boolean);
        if (cleaned.length > 0) return toPairs(cleaned);
      }
    }
  }

  // Fallback: split on REPLY N: markers (survives even if COMMENT markers were stripped).
  const replyBlocks = text
    .split(/REPLY\s*\d+:\s*/i)
    .slice(1)
    .map((b) => b.split(/COMMENT\s*\d+:/i)[0].trim())
    .filter(Boolean);
  if (replyBlocks.length > 0) return toPairs(replyBlocks);

  // Last resort: single comment → whole text is the reply.
  return [{ comment: commentLines[0] || 'Comment 1', reply: text.trim() }];
}
