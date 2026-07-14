import type { CreatorProfileForPrompt } from '@/lib/ai';

/**
 * Pure builders for event-capture draft generation. Extracted from the /process
 * route so the answer-import and pillar-resolution logic is unit-testable without
 * a DB or the LLM.
 */

/**
 * Sanitizes a single Q&A answer before storage: trim, strip control characters
 * (except tab/newline), and cap at 500 chars. Keeps stored answers clean so they
 * paste safely into the generation prompt.
 */
export function sanitizeAnswer(raw: string): string {
  return raw
    .trim()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .slice(0, 500);
}

/**
 * Pairs each question with its answer to form the "what happened" block fed to
 * the generator. Answers are keyed by the question INDEX as a string ("0".."4")
 * - the same contract the UI writes and /answers stores. Questions with no
 * answer are dropped; returns '' when nothing is answered.
 *
 * This is the exact join that carries the user's answers into the written post,
 * so the index-key contract here is what makes "answers imported to Write" work.
 */
export function buildQuestionsAndAnswers(
  questions: string[] | null | undefined,
  answers: Record<string, string> | null | undefined,
): string {
  return (
    questions
      ?.map((q, i) => {
        const answer = answers?.[String(i)];
        return answer && answer.trim().length > 0 ? `Q: ${q}\nA: ${answer}` : null;
      })
      .filter(Boolean)
      .join('\n\n') ?? ''
  );
}

/**
 * Resolves the pillar for a generated post: the creator's first content pillar,
 * else 'general'. posts.pillar is NOT NULL, so this must always return a value.
 */
export function resolvePostPillar(
  profile: Pick<CreatorProfileForPrompt, 'content_pillars'> | null | undefined,
): string {
  return profile?.content_pillars?.[0]?.name || 'general';
}

/**
 * Builds the deep link that opens the Write (/generate) editor prefilled with a
 * generated event draft, so the user can humanize/edit it with the full Write
 * toolset. /generate reads `result` (post text) and `topic` (event title).
 */
export function buildWriteUrl(text: string, title: string): string {
  const params = new URLSearchParams({ result: text, topic: title });
  return `/generate?${params.toString()}`;
}
