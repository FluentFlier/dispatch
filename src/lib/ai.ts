import { chatCompletion } from '@/lib/llm';
import { voiceEvidenceOnly, stripSections, VOICE_EVIDENCE_HEADERS } from '@/lib/content-pipeline/context-split';

/**
 * Default template used to seed new creator profiles during onboarding.
 * Never rendered directly in AI calls — use buildSystemPrompt() instead.
 */
export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are a content strategist. You help creators write authentic, specific content for their social media. Follow the creator's voice and context provided below. Never use em dashes. If no creator context is provided, write direct, honest, punchy content.

RULES:
- No em dashes anywhere. Ever.
- No markdown formatting. No **bold**, no *italic*, no # headers, no bullet asterisks. Plain text only.
- No corporate speak or influencer fluff
- Never genericize a specific detail
- If a 16 year old cannot follow an explanation, simplify more
- Short punchy sentences
- Talk TO the viewer, not AT them`;

export interface CreatorProfileForPrompt {
  display_name: string;
  bio?: string;
  bio_facts?: string;
  content_pillars?: Array<{ name: string; description?: string; promptTemplate?: string; weight?: number }>;
  voice_description?: string;
  voice_rules?: string;
}

/**
 * Builds a personalized system prompt from the user's creator profile.
 * Falls back to the default template if no profile is provided.
 */
export function buildSystemPrompt(
  profile?: CreatorProfileForPrompt | null,
  contextAdditions?: string
): string {
  if (!profile) {
    const base = DEFAULT_SYSTEM_PROMPT_TEMPLATE;
    if (contextAdditions) {
      return `${base}\n\nADDITIONAL CONTEXT:\n${contextAdditions}`;
    }
    return base;
  }

  const parts: string[] = [];

  parts.push(
    `You are a content strategist for ${profile.display_name}. You help them write authentic, specific content for their social media. Follow their voice and context closely. Never use em dashes.`
  );

  parts.push(`\nRULES:
- No em dashes anywhere. Ever.
- No markdown formatting. No **bold**, no *italic*, no # headers, no bullet asterisks. Plain text only.
- No corporate speak or influencer fluff
- Never genericize a specific detail
- If a 16 year old cannot follow an explanation, simplify more
- Short punchy sentences
- Talk TO the viewer, not AT them`);

  parts.push(`\nSUBJECT (CRITICAL):
- Write about the SUBJECT the user asks for in their request. That subject IS the post.
- The bio, background facts, and pillars below are for VOICE, PERSPECTIVE, and CREDIBILITY - they are NOT the subject.
- Do NOT redirect the post to the creator's hobbies, job, or background unless the request is actually about them. Only bring in a personal detail if it directly serves the requested subject.`);

  if (profile.bio) {
    parts.push(`\nCREATOR BIO (voice + perspective, not the subject):\n${profile.bio}`);
  }

  if (profile.bio_facts?.trim()) {
    parts.push(`\nBACKGROUND FACTS (for credibility + voice only, not the subject):\n${profile.bio_facts.trim()}`);
  }

  if (profile.voice_description) {
    parts.push(`\nVOICE:\n${profile.voice_description}`);
  }

  if (profile.voice_rules) {
    parts.push(`\nVOICE RULES (MUST FOLLOW):\n${profile.voice_rules}`);
  }

  if (profile.content_pillars && profile.content_pillars.length > 0) {
    // Order by importance so the model leads with the creator's main topics, and
    // surface the weight so it knows how much to emphasize each one.
    const sorted = [...profile.content_pillars].sort(
      (a, b) => (b.weight ?? 50) - (a.weight ?? 50),
    );
    const pillarLines = sorted.map((p) => {
      let line = `- ${p.name}`;
      if (typeof p.weight === 'number') line += ` [importance ${p.weight}/100]`;
      if (p.description) line += `: ${p.description}`;
      return line;
    });
    parts.push(
      `\nCONTENT PILLARS (the creator's usual themes; lead with the highest-importance one ONLY when the request doesn't specify a different subject):\n${pillarLines.join('\n')}`,
    );
  }

  if (contextAdditions) {
    // Voice evidence (fingerprint, structural patterns, real example posts) is
    // the strongest cloning signal the model gets - stronger than any abstract
    // rule list. Labeling it "reference only" told small models to ignore it
    // (audit P1-2). Split it out as authoritative; everything else stays
    // reference-only so brain/memory facts can't hijack the post.
    const voiceEvidence = voiceEvidenceOnly(contextAdditions);
    const reference = stripSections(contextAdditions, VOICE_EVIDENCE_HEADERS);
    if (voiceEvidence) {
      parts.push(
        `\nVOICE EVIDENCE (authoritative - this is how ${profile.display_name} actually writes; match the vocabulary, rhythm, sentence framing, and structure exactly):\n${voiceEvidence}`,
      );
    }
    if (reference) {
      parts.push(
        `\nADDITIONAL CONTEXT (reference only — the VOICE RULES above are authoritative; do not introduce companies, products, or claims that are not in this creator's profile):\n${reference}`,
      );
    }
  }

  return parts.join('\n');
}

/**
 * Generates content via the configured LLM provider (Groq/OpenAI/Claude/HF).
 * Provider is chosen by env (LLM_BASE_URL/LLM_API_KEY/LLM_MODEL); falls back to
 * HuggingFace when those are unset. No provider name is hardcoded here, so
 * swapping models is an env change, not a code change.
 * modelOverride, when provided, overrides the env model for this single call.
 */
export async function generateContent(
  prompt: string,
  contextAdditions?: string,
  systemOverride?: string,
  profile?: CreatorProfileForPrompt | null,
  modelOverride?: string
): Promise<string> {
  let systemPrompt: string;
  if (systemOverride) {
    // The override owns the task framing, but a caller that ALSO passes a profile
    // or context (e.g. event question generation) wants that personalization used.
    // Previously the override was used verbatim and profile/context were silently
    // dropped (break 13). Append a compact creator-reference block so the override
    // stays authoritative while the personalization still reaches the model. No-op
    // when neither profile nor context is provided, so raw-override callers are
    // unaffected.
    const ref = buildProfileReferenceBlock(profile, contextAdditions);
    systemPrompt = ref ? `${systemOverride}\n\n${ref}` : systemOverride;
  } else {
    systemPrompt = buildSystemPrompt(profile, contextAdditions);
  }

  return chatCompletion(systemPrompt, prompt, modelOverride ? { model: modelOverride } : undefined);
}

/**
 * Compact, appendable creator-reference block for use alongside a systemOverride.
 * Unlike buildSystemPrompt it carries NO post-writing preamble/rules — just the
 * identity + voice facts — so it personalizes an override (question generation,
 * etc.) without redirecting it to "write a post". Returns '' when there is nothing
 * to add.
 */
function buildProfileReferenceBlock(
  profile?: CreatorProfileForPrompt | null,
  contextAdditions?: string,
): string {
  const parts: string[] = [];
  if (profile?.display_name) parts.push(`Creator: ${profile.display_name}`);
  if (profile?.bio) parts.push(`Bio: ${profile.bio}`);
  if (profile?.bio_facts?.trim()) parts.push(`Background facts: ${profile.bio_facts.trim()}`);
  if (profile?.voice_description) parts.push(`Voice: ${profile.voice_description}`);
  if (profile?.voice_rules) parts.push(`Voice rules: ${profile.voice_rules}`);
  if (contextAdditions?.trim()) parts.push(`Additional context:\n${contextAdditions.trim()}`);
  if (parts.length === 0) return '';
  return `CREATOR REFERENCE (personalize to this creator; do not invent facts):\n${parts.join('\n')}`;
}
