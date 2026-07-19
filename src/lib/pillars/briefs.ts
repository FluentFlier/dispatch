import { normalizePillarSlug } from '@/lib/pillars';

/**
 * Pure, client-safe pillar-brief resolution (no server/LLM imports, so it can
 * be bundled into the generate UI). The LLM generation + backfill live in
 * briefs-generate.ts.
 *
 * Built-in generation briefs for the app's original pillar slugs. These used to
 * live client-only in ScriptGenerator (so they steered only the client first
 * draft, never the server pipeline). Shared here so both sides - and any
 * custom pillar via its stored promptTemplate - resolve a brief the same way.
 */
export const BUILT_IN_PILLAR_BRIEFS: Record<string, string> = {
  'hot-take': `Write a hot take in the creator's voice (pick a strong angle from their real experience if no topic is given). Open with one bold, scroll-stopping line that states the controversial claim, then back it with a specific real example from the creator's background, turn to what people should think or do instead, and close with one direct question. Write it as flowing paragraphs, not labeled beats or one-line fragments. Under 60 seconds when spoken. No em dashes.`,
  hackathon: `Write a hackathon story in the creator's voice, drawn from one specific, real, dramatic moment. Drop straight into the most intense moment with no setup, give just enough of the challenge and stakes to make it land, then what changed under pressure and what it taught about building. End by asking viewers about their own experience. Flowing paragraphs, not a beat list. No em dashes.`,
  founder: `Write a founder-in-public update in the creator's voice about building their product or startup. Open with one honest, vulnerable line (real energy, no spin), be specific about what was hard or went wrong, name the one thing that actually moved, and what it is teaching about startups. Invite other builders to share their week. Sound like Tuesday at 11pm, not a polished success story. Flowing paragraphs, not a beat list. No em dashes.`,
  explainer: `Write a concept explainer in the creator's voice from their expertise (pick one concept from their domain if no topic is given). Open with a question that makes the reader feel they are missing something, explain it simply enough for a 16-year-old with zero jargon, say why it matters, correct the common misconception, and close by asking what to explain next. Flowing paragraphs, not a beat list. Under 60 seconds when spoken. No em dashes.`,
  origin: `Write an origin/arc piece in the creator's voice from their real background and journey. Open with one specific detail that makes someone lean in, move through the unexpected parts of the path, name the through-line that actually connects them, and where it is heading now. Invite non-linear paths in the comments. Flowing paragraphs, not a beat list. No em dashes.`,
  research: `Write a "research unlocked" piece in the creator's voice that makes their research feel accessible and interesting. Open with a line that hooks even someone who hates science, share what is genuinely surprising about the research and its real-world stakes, then the meta lesson about what doing research teaches that classes do not. Ask if they knew this kind of research existed. Flowing paragraphs, not a beat list. No em dashes.`,
};

/** True when a pillar is one of the built-ins (which have a bundled brief). */
export function isBuiltInPillar(name: string): boolean {
  return normalizePillarSlug(name) in BUILT_IN_PILLAR_BRIEFS;
}

/**
 * The generation brief for a pillar: its stored promptTemplate if set, else the
 * built-in brief for the original slugs, else null (no bespoke steer). This is
 * the single resolver used by the client first-draft AND the server prompt.
 */
export function resolvePillarBrief(name: string, promptTemplate?: string | null): string | null {
  if (promptTemplate?.trim()) return promptTemplate.trim();
  return BUILT_IN_PILLAR_BRIEFS[normalizePillarSlug(name)] ?? null;
}
