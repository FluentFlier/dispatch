/**
 * Engager research dossier.
 *
 * Before reaching out to a post engager we build a tiny research brief: who they
 * are, why they matter to the user's current agenda, and the most natural angle
 * for outreach. The nurture drafters feed this into the voice pipeline so the
 * connect note / DM reference something real instead of a generic "saw your
 * profile". LLM-backed, with a deterministic fallback so the sequence never
 * stalls when the model is unconfigured or rate-limited.
 */
import { chatCompletion, isLlmConfigured } from '@/lib/llm';
import type { Agenda } from '@/lib/signals/leads/agenda';
import type { EngagerDossier, WarmContactRow } from '@/lib/social-graph/types';

/** Minimal, provider-agnostic input for building a dossier. */
export interface DossierInput {
  name: string | null;
  headline: string | null;
  category: string | null;
  reactionType: string | null;
  sourcePostTitle: string | null;
  /** Excerpt of a recent post by THEM (improves the angle when available). */
  recentPostExcerpt: string | null;
}

/** Projects a warm contact (+ optional recent post) into dossier input. */
export function dossierInputFromContact(
  contact: Pick<
    WarmContactRow,
    'display_name' | 'headline' | 'category' | 'reaction_type' | 'source_post_title'
  >,
  recentPostExcerpt?: string | null,
): DossierInput {
  return {
    name: contact.display_name ?? null,
    headline: contact.headline ?? null,
    category: contact.category ?? null,
    reactionType: contact.reaction_type ?? null,
    sourcePostTitle: contact.source_post_title ?? null,
    recentPostExcerpt: recentPostExcerpt?.trim() || null,
  };
}

const MAX_FIELD = 400;

function clamp(text: string, max = MAX_FIELD): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Deterministic dossier used when the LLM is unavailable or errors. Reads a bit
 * flat but is always accurate and safe (no hallucinated facts), so the sequence
 * still runs with a sensible angle.
 */
function fallbackDossier(input: DossierInput, agenda: Agenda): EngagerDossier {
  const who = input.name?.trim() || 'This person';
  const role = input.headline ? ` (${clamp(input.headline, 120)})` : '';
  const engaged = input.sourcePostTitle
    ? `engaged with your post "${clamp(input.sourcePostTitle, 120)}"`
    : 'engaged with your content';
  return {
    summary: clamp(`${who}${role} ${engaged}.`),
    whyMatters: clamp(
      `${who} is a warm contact for the "${agenda.name}" agenda - they already know your work, so a follow-up is welcome rather than cold.`,
    ),
    angle: clamp(agenda.pitchAngle),
    generatedAt: new Date().toISOString(),
  };
}

function parseDossierJson(raw: string): { summary?: string; whyMatters?: string; angle?: string } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Builds a research dossier for an engager against the given agenda. Uses the
 * LLM when configured, falling back to the deterministic brief on any failure so
 * callers can always rely on a well-formed {@link EngagerDossier}.
 */
export async function buildEngagerDossier(
  input: DossierInput,
  agenda: Agenda,
): Promise<EngagerDossier> {
  if (!isLlmConfigured()) return fallbackDossier(input, agenda);

  const system = [
    'You are a sharp GTM research assistant.',
    'Given a person who engaged with the user\'s social post and the user\'s outreach agenda,',
    'write a tight research brief that helps the user reach out authentically.',
    'Return ONLY compact JSON: {"summary","whyMatters","angle"}.',
    'summary: 1 sentence on who they are. whyMatters: 1 sentence on why they fit this agenda.',
    'angle: 1 sentence, a specific, low-pressure, peer-to-peer opening angle. Never salesy. No emojis, no hashtags, no em dashes.',
    'Do not invent facts not supported by the inputs.',
  ].join(' ');

  const user = [
    `Agenda: ${agenda.name} (goal: ${agenda.goalType}).`,
    `Agenda angle: ${agenda.pitchAngle}`,
    agenda.toneRules ? `Tone rules: ${agenda.toneRules}` : null,
    input.name ? `Name: ${input.name}` : null,
    input.headline ? `Headline: ${input.headline}` : null,
    input.category ? `Fit category: ${input.category}` : null,
    input.reactionType ? `How they engaged: ${input.reactionType}` : null,
    input.sourcePostTitle ? `Your post they engaged with: "${input.sourcePostTitle}"` : null,
    input.recentPostExcerpt ? `A recent post by them: "${clamp(input.recentPostExcerpt, 600)}"` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await chatCompletion(system, user, { maxTokens: 320, temperature: 0.5 });
    const parsed = parseDossierJson(raw);
    if (!parsed?.summary || !parsed.whyMatters || !parsed.angle) {
      return fallbackDossier(input, agenda);
    }
    return {
      summary: clamp(parsed.summary),
      whyMatters: clamp(parsed.whyMatters),
      angle: clamp(parsed.angle),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return fallbackDossier(input, agenda);
  }
}
