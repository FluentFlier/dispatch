import { generateContent } from './ai';
import type { CreatorProfileForPrompt } from './ai';
import { HfInference } from '@huggingface/inference';

/**
 * Humanizer: Detects and removes 29 AI writing patterns to make content
 * sound authentically human. Based on Wikipedia's "Signs of AI writing" guide.
 *
 * Patterns detected:
 * - Content: significance inflation, name-dropping, vague attributions
 * - Language: overused AI vocabulary, copula avoidance, excessive hedging
 * - Style: em dash overuse, title case, emoji padding
 * - Communication: chatbot artifacts, sycophantic tone, filler conclusions
 */

const HUMANIZER_PROMPT = `You are a text humanizer. Your job is to rewrite AI-generated text so it reads like a real human wrote it.

DETECT AND FIX these 29 AI writing patterns:

**Content patterns:**
1. Significance inflation ("groundbreaking", "pivotal", "revolutionary" when not warranted)
2. Name-dropping and false authority
3. Vague attributions ("experts say", "studies show" without specifics)
4. Padding with obvious statements
5. Repetitive thesis restatement
6. Generic examples that could apply to anything

**Language patterns:**
7. Overused AI words: delve, tapestry, leverage, foster, landscape, nuanced, multifaceted, comprehensive, robust, holistic, pivotal, crucial, paramount, innovative, transformative, utilize
8. Copula avoidance ("serves as" instead of "is", "features" instead of "has")
9. Excessive hedging ("It is worth noting that...")
10. Paired near-synonyms ("diverse and varied", "challenges and obstacles")
11. Unnecessary transitional phrases
12. Overly formal register for casual topics

**Style patterns:**
13. Em dash overuse
14. Excessive use of colons for lists
15. Title case in headings where sentence case is normal
16. Emoji as section decorators
17. Bullet point padding
18. Artificially balanced paragraph lengths

**Communication patterns:**
19. Chatbot artifacts ("I hope this helps!", "Great question!")
20. Sycophantic openers ("That's a fantastic point")
21. Filler conclusions ("In conclusion, it is clear that...")
22. Meta-commentary ("Let me break this down for you")
23. Disclaimer hedging ("While I cannot provide medical advice...")
24. Artificial enthusiasm markers (excessive exclamation marks)

**Structure patterns:**
25. Perfect three-point structure (everything in threes)
26. Mirror structure (repeating the question back)
27. Numbered list as default organization
28. Topic sentence + 3 supporting points + conclusion in every paragraph
29. Artificial balance (equal weight to all sides)

RULES:
- Keep the core message and facts intact
- Match the voice/tone described below
- Make it sound like a real person typed it quickly
- Vary sentence length naturally
- Use contractions where natural
- Don't add new information
- Don't make it longer than the original
- No markdown formatting. No **bold**, no *italic*, no # headers. Plain text only.

Return ONLY the rewritten text. No explanations, no meta-commentary.`;

/**
 * Humanize AI-generated content by removing telltale AI patterns.
 * Optionally matches the creator's voice profile.
 */
export async function humanize(
  text: string,
  profile?: CreatorProfileForPrompt | null
): Promise<string> {
  const voiceContext = profile
    ? `\n\nVOICE TO MATCH:\nName: ${profile.display_name}\n${profile.bio_facts ? `Background: ${profile.bio_facts}\n` : ''}${profile.voice_description ? `Voice: ${profile.voice_description}\n` : ''}${profile.voice_rules ? `Rules: ${profile.voice_rules}` : ''}`
    : '';

  const result = await generateContent(
    `Humanize this text:${voiceContext}\n\n---\n${text}\n---`,
    undefined,
    HUMANIZER_PROMPT,
  );

  return result.trim();
}

/**
 * Deterministic AI-writing patterns. Each match is a "tell" that the text reads
 * like generic LLM output. Used as a floor under the ML detector so the score
 * never collapses to a neutral 50 when the model is weak or unavailable.
 */
const AI_SLOP_PATTERNS: RegExp[] = [
  // Overused LLM vocabulary
  /\b(delve|tapestry|leverage|foster|landscape|nuanced|multifaceted|comprehensive|robust|holistic|pivotal|crucial|paramount|innovative|transformative|utilize|realm|underscore|testament|seamless|elevate|empower|unlock|harness|navigate|cultivate|embark|profound)\b/gi,
  // Throat-clearing openers / framing
  /\bin today'?s (?:fast-paced |digital |modern |competitive )?world\b/gi,
  /\bit'?s (?:worth|important) (?:noting|to note|mentioning)\b/gi,
  /\b(?:in conclusion|to sum up|in summary|ultimately,|at the end of the day)\b/gi,
  /\blet'?s (?:dive|unpack|explore|break (?:it|this) down)\b/gi,
  // Symmetric / hedging constructions
  /\bnot only\b[^.]*\bbut also\b/gi,
  /\bwhether you'?re\b/gi,
  // Hype + decorative em dashes
  /\bgame[- ]chang(?:er|ing)\b/gi,
  /—/g,
];

/**
 * Heuristic AI score (0-100). Counts AI "tells"; ~12 points per tell, capped.
 * Conservative but reliable for obvious slop; complements the ML detector.
 */
function heuristicAiScore(text: string): number {
  let hits = 0;
  for (const re of AI_SLOP_PATTERNS) {
    const matches = text.match(re);
    if (matches) hits += matches.length;
  }
  return Math.min(100, hits * 12);
}

/**
 * Splits text into <=480-char windows (roberta truncates ~512 tokens) so long
 * posts are scored end-to-end, not just their opening line.
 */
function chunkForDetector(text: string, maxChunks = 3): string[] {
  const size = 480;
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < maxChunks; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Score how "AI-sounding" text is. Combines HuggingFace's chatgpt-detector-roberta
 * (scored across chunks, taking the max) with a deterministic heuristic floor, and
 * returns the higher of the two. Returns 0-100 (100 = obviously AI).
 *
 * WHY the floor: the ML model under-flags short marketing/LinkedIn copy and, on any
 * error or label-shape drift, previously returned a misleading neutral 50. The
 * heuristic guarantees obvious slop is caught even when the model is weak or down.
 */
export async function aiScore(text: string): Promise<{ score: number; flags: string[] }> {
  const heuristic = heuristicAiScore(text);

  let modelScore: number | null = null;
  try {
    const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
    const chunks = chunkForDetector(text);
    const results = await Promise.all(
      chunks.map((chunk) =>
        hf.textClassification({ model: 'Hello-SimpleAI/chatgpt-detector-roberta', inputs: chunk }),
      ),
    );

    const chunkScores = results.map((result) => {
      // Robust label matching: prefer an explicit AI/ChatGPT label; else derive
      // from the Human label; else fall back to roberta's LABEL_1 (= ChatGPT).
      const ai = result.find((r) => /chat\s?gpt|^ai$|fake|label_1/i.test(r.label));
      if (ai) return ai.score;
      const human = result.find((r) => /human|label_0/i.test(r.label));
      if (human) return 1 - human.score;
      return null;
    });

    const valid = chunkScores.filter((s): s is number => s !== null);
    if (valid.length > 0) modelScore = Math.round(Math.max(...valid) * 100);
  } catch {
    modelScore = null; // fall through to heuristic-only
  }

  const score = modelScore === null ? heuristic : Math.max(modelScore, heuristic);

  const flags: string[] = [];
  if (modelScore === null) flags.push('model_unavailable');
  if (score > 70) flags.push('detected_as_ai');
  return { score, flags };
}
