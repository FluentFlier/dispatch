import { generateContent } from '@/lib/ai';
import type { EventType } from '@/lib/event-capture/filter';
import type { CreatorProfileForPrompt } from '@/lib/ai';

// --- Input / Output types ---

export interface EventQuestionsContext {
  /** Raw event title from calendar */
  title: string;
  /** ISO 8601 date string of the event start */
  startDate: string;
  /** Event location (venue name, city, or "Remote") */
  location?: string | null;
  /** Classified event type from Stage 1 filter */
  eventType: EventType;
  /** Whether this is a public event with web research */
  isPublicEvent: boolean;
  /** Research summary (from event_research table) if available */
  researchSummary?: string | null;
  /** Raw research text (truncated to 2000 tokens) */
  researchRawText?: string | null;
  /** Creator content pillars for relevance anchoring */
  contentPillars?: Array<{ name: string; description?: string }>;
  /** Creator profile (display name, bio) for personalization */
  profile?: CreatorProfileForPrompt | null;
}

/**
 * Generates 5 event-specific Q&A questions using Claude Haiku.
 * Questions are conversational (8-12 words each), specific to the event type,
 * and anchored to the creator's content pillars when available.
 *
 * Returns an array of exactly 5 strings, or throws if generation fails.
 * Caller (Stage 2 cron) catches and sets status='error' for retry.
 */
export async function generateEventQuestions(
  ctx: EventQuestionsContext,
): Promise<string[]> {
  const pillarContext = ctx.contentPillars?.length
    ? `Creator's content pillars (anchor questions to these when relevant):\n${ctx.contentPillars.map((p) => `- ${p.name}${p.description ? ': ' + p.description : ''}`).join('\n')}`
    : '';

  const researchContext = ctx.researchRawText
    ? `\nResearch about this event (use details to make questions specific):\n${ctx.researchRawText}`
    : '';

  const systemPrompt = `You generate conversational Q&A questions about professional events. Questions must be:
- Specific to THIS event (use the actual event name, topics, people)
- 8-12 words each (short, conversational, not formal)
- No corporate language, no "please describe" or "could you explain"
- No em dashes — use hyphens or rewrite
- Varied: mix takeaways, personal reactions, specific moments, actionable insights
- Appropriate for ${ctx.eventType} type events
Return EXACTLY 5 questions, one per line, no numbering, no extra text.`;

  const userPrompt = `Event: ${ctx.title}
Date: ${ctx.startDate}${ctx.location ? `\nLocation: ${ctx.location}` : ''}
Type: ${ctx.eventType}
${pillarContext}${researchContext}

Generate 5 questions to help capture the key moments and insights from this event.`;

  const raw = await generateContent(userPrompt, undefined, systemPrompt, ctx.profile ?? null);

  // Parse lines — filter blanks and numbering artifacts.
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/^\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 0);

  // Guarantee exactly 5 questions. Pad with generic fallbacks if Haiku returns fewer.
  const fallbacks = [
    'What was the most surprising thing you learned?',
    'What one idea will you act on this week?',
    'Who did you connect with and what did they say?',
    'What moment stood out most and why?',
    'What would you tell someone who missed it?',
  ];

  const questions: string[] = [];
  for (let i = 0; i < 5; i++) {
    questions.push(lines[i] ?? fallbacks[i]);
  }

  return questions;
}
