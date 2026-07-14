/**
 * Assemble the final generation prompt from the base (pillar) prompt plus the
 * user's optional topic, braindump "thoughts", and a length hint.
 *
 * WHY a dedicated helper: the braindump box MUST reach the LLM every time, and
 * the /api/generate schema caps `prompt` at 10000 chars - so assembly + a safe
 * length cap live in one tested place instead of being inlined and drifting.
 */

/** Must match the max on /api/generate's RequestSchema.prompt. */
export const MAX_PROMPT_LEN = 10_000;

export interface PromptParts {
  /** The pillar/template base prompt. */
  base: string;
  /** Optional subject the post should be about. */
  topic?: string;
  /** Optional freeform braindump: details/facts/angle the user wants included. */
  thoughts?: string;
  /** Optional length hint appended last. */
  lengthHint?: string;
}

/**
 * Build the prompt. The topic and thoughts are always included (never silently
 * dropped) as long as they fit; if the total would exceed MAX_PROMPT_LEN, the
 * braindump is truncated last (it is the most compressible part) so the base +
 * topic + length hint always survive.
 */
export function assembleGeneratePrompt(parts: PromptParts): string {
  const base = parts.base.trim();
  const topic = parts.topic?.trim();
  const thoughts = parts.thoughts?.trim();
  const lengthHint = parts.lengthHint?.trim();

  const topicBlock = topic
    ? `\n\nWRITE ABOUT THIS SUBJECT (this is the post, do not drift to unrelated personal background): ${topic}`
    : '';
  const hintBlock = lengthHint ? `\n\n${lengthHint}` : '';

  // Reserve room for base + topic + hint; the braindump takes what's left.
  const fixed = base + topicBlock + hintBlock;
  if (!thoughts) return fixed.slice(0, MAX_PROMPT_LEN);

  const thoughtsHeader = '\n\nDETAILS AND THOUGHTS FROM THE CREATOR (you MUST incorporate these specifics into the post):\n';
  const room = MAX_PROMPT_LEN - (fixed.length + thoughtsHeader.length);
  if (room <= 0) {
    // No space for the braindump - keep the essential prompt.
    return fixed.slice(0, MAX_PROMPT_LEN);
  }
  const clippedThoughts = thoughts.length > room ? thoughts.slice(0, room) : thoughts;

  // Order: base -> topic -> braindump -> length hint, so the length hint stays last.
  return (base + topicBlock + thoughtsHeader + clippedThoughts + hintBlock).slice(0, MAX_PROMPT_LEN);
}
