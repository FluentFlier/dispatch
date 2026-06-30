import { chatCompletion } from '@/lib/llm';

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
  content_pillars?: Array<{ name: string; description?: string; promptTemplate?: string }>;
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

  if (profile.bio) {
    parts.push(`\nCREATOR BIO:\n${profile.bio}`);
  }

  if (profile.bio_facts?.trim()) {
    parts.push(`\nBACKGROUND FACTS:\n${profile.bio_facts.trim()}`);
  }

  if (profile.voice_description) {
    parts.push(`\nVOICE:\n${profile.voice_description}`);
  }

  if (profile.voice_rules) {
    parts.push(`\nVOICE RULES (MUST FOLLOW):\n${profile.voice_rules}`);
  }

  if (profile.content_pillars && profile.content_pillars.length > 0) {
    const pillarLines = profile.content_pillars.map((p) => {
      let line = `- ${p.name}`;
      if (p.description) line += `: ${p.description}`;
      return line;
    });
    parts.push(`\nCONTENT PILLARS:\n${pillarLines.join('\n')}`);
  }

  if (contextAdditions) {
    parts.push(
      `\nADDITIONAL CONTEXT (reference only — the VOICE RULES above are authoritative; do not introduce companies, products, or claims that are not in this creator's profile):\n${contextAdditions}`,
    );
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
  const systemPrompt = systemOverride
    ? systemOverride
    : buildSystemPrompt(profile, contextAdditions);

  return chatCompletion(systemPrompt, prompt, modelOverride ? { model: modelOverride } : undefined);
}
