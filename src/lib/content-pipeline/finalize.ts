import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import type { ContentPipelineResult, PipelineStage } from './index';

export function stripEmDashes(text: string): string {
  return text.replace(/—/g, ' - ').replace(/–/g, '-');
}

/**
 * Final formatting guard. The stage prompts all say "plain text, no markdown",
 * but LLMs still leak emphasis markers, headings, and code fences - which
 * LinkedIn and X render literally (**bold**, ## Heading), making a post look
 * broken. Strip the markdown syntax while keeping the words. Runs once at the
 * finalize choke point so every return path is clean. Conservative on purpose:
 * leaves single underscores (snake_case), list dashes, and normal punctuation
 * untouched - it only removes syntax that renders as noise on social.
 */
export function stripMarkdownFormatting(text: string): string {
  return (
    text
      // Fenced code blocks: keep the inner code, drop the ``` fences.
      .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1')
      // Inline code: `x` -> x
      .replace(/`([^`\n]+)`/g, '$1')
      // Bold/italic: **x** __x__ ***x*** -> x
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      // Single-asterisk italic: *x* -> x (guard against bare/list asterisks)
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, '$1$2')
      // ATX headings at line start: "## Title" -> "Title"
      .replace(/^#{1,6}[ \t]+/gm, '')
      // Blockquote markers at line start: "> quote" -> "quote"
      .replace(/^[ \t]*>[ \t]?/gm, '')
      // Collapse runs of blank lines the stripping may have opened up.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Merges short paragraphs into flowing 3+ sentence blocks so prose never reads
 * like a transcript. This is a hard platform floor: a creator's own
 * voice_rules can ask the model for "short one or two-sentence paragraphs"
 * (voice synthesis learns this from real samples, and one live profile did
 * exactly that), but no per-creator instruction should be able to degrade
 * every post on the platform into a wall of choppy micro-paragraphs. A
 * 2-sentences-per-paragraph draft still reads staccato even though no single
 * paragraph is "wrong" in isolation - the floor is 3, not 2, so it actually
 * reduces paragraph count. The opening hook and the closing line are exempt -
 * those are allowed to stand alone by design.
 */
export function enforceParagraphFloor(text: string): string {
  const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 2) return text;

  const sentenceCount = (p: string) => (p.match(/[.!?](?=\s|["')\]]*(?:\s|$))/g) || []).length || 1;

  const hook = paras[0];
  const closing = paras[paras.length - 1];
  const middle = paras.slice(1, -1);

  const mergedMiddle: string[] = [];
  let buffer = '';
  let bufferSentences = 0;
  for (const p of middle) {
    buffer = buffer ? `${buffer} ${p}` : p;
    bufferSentences += sentenceCount(p);
    if (bufferSentences >= 3) {
      mergedMiddle.push(buffer);
      buffer = '';
      bufferSentences = 0;
    }
  }
  if (buffer) mergedMiddle.push(buffer);

  return [hook, ...mergedMiddle, closing].join('\n\n');
}

export function finalizeResult(
  text: string,
  enforceParagraphs: boolean,
  evaluation: VoiceEvaluationMatrix | undefined,
  revised: boolean,
  flags: string[],
  stagesCompleted: PipelineStage[],
  humanizePasses: string[] | undefined,
  usedHookIds: string[] | undefined,
  iterations = 0,
  hookExplanations?: ContentPipelineResult['hookExplanations'],
): ContentPipelineResult {
  const voice_match_score = evaluation
    ? Math.round((evaluation.persona_fidelity / 10) * 100)
    : 0;
  const ai_score = evaluation ? evaluation.ai_slop * 10 : 0;

  // Single guarantee that no markdown/em-dash noise reaches the client, whatever
  // path produced this draft (fast, voice-off, hooks, revise loop). Paragraph
  // floor only applies to prose (post/reply/comment) - hook lists and captions
  // have their own intentional one-line-per-item format.
  let cleanText = stripMarkdownFormatting(stripEmDashes(text));
  if (enforceParagraphs) cleanText = enforceParagraphFloor(cleanText);

  return {
    text: cleanText,
    voice_match_score,
    ai_score,
    revised,
    flags,
    evaluation,
    iterations,
    usedHookIds,
    hookExplanations,
    stagesCompleted,
    humanizePasses,
  };
}
