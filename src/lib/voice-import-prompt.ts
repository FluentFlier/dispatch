/** Prompt users paste into ChatGPT, Claude, Gemini, etc. to export writing voice + context. */
export const CHATGPT_VOICE_EXPORT_PROMPT = `Export all stored memories and context you've learned about me — especially how I write, my tone, my work, and any rules I've given you for content.

## Categories (output in this order):

1. **Writing instructions**: Rules I've explicitly asked you to follow — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only from stored memories, not one-off chats.

2. **Who I am**: Name, role, what I do, who my audience is, background facts.

3. **Topics I write about**: Themes, niches, content pillars, projects I talk about publicly.

4. **Voice & style**: How I sound — sentence length, humor, perspective, signature phrases, words I avoid.

## Format:

Use section headers for each category. Within each category, one entry per line, oldest first:

[YYYY-MM-DD] - Entry content here.

If no date is known, use [unknown].

## Output:

- Wrap the entire export in a single code block for easy copying.
- After the code block, say whether this is complete or if more remains.`;

export function stripJsonFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export interface ImportedVoiceProfile {
  display_name?: string | null;
  bio_facts?: string | null;
  voice_description?: string | null;
  voice_rules?: string | null;
}
