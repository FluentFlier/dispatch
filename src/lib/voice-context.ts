import type { createClient } from '@insforge/sdk';
import type { CreatorProfileForPrompt } from '@/lib/claude';
import { retrieveBrainContext } from '@/lib/brain/retrieve';
import { searchUserContext } from '@/lib/supermemory';

type InsforgeClient = ReturnType<typeof createClient>;

export interface VocabularyFingerprint {
  uses_often?: string[];
  never_uses?: string[];
  signature_phrases?: string[];
}

export interface StructuralPatterns {
  avg_sentence_length?: string;
  paragraph_style?: string;
  hook_pattern?: string;
  closing_pattern?: string;
}

export interface VoiceSample {
  content: string;
  platform?: string;
}

export interface CreatorVoiceContext {
  profile: CreatorProfileForPrompt | null;
  contextAdditions: string;
}

interface LoadVoiceContextOptions {
  /** Topic or post idea — triggers Supermemory retrieval when set */
  memoryQuery?: string;
  /** Max few-shot samples injected into the prompt */
  maxSamples?: number;
}

function parseJsonSetting<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function formatList(label: string, items: string[] | undefined): string {
  if (!items?.length) return '';
  return `${label}: ${items.join(', ')}`;
}

/**
 * Builds supplemental prompt context from Voice Lab artifacts and optional memory.
 */
export function buildVoiceContextAdditions({
  bioFacts,
  vocabulary,
  structural,
  samplePosts,
  brainSnippets,
  memorySnippets,
  userContext,
}: {
  bioFacts?: string;
  vocabulary?: VocabularyFingerprint;
  structural?: StructuralPatterns;
  samplePosts?: VoiceSample[];
  brainSnippets?: string[];
  memorySnippets?: string[];
  userContext?: string;
}): string {
  const sections: string[] = [];

  if (userContext?.trim()) {
    sections.push(`USER CONTEXT:\n${userContext.trim()}`);
  }

  if (bioFacts?.trim()) {
    sections.push(`BACKGROUND FACTS (use specific details, never genericize):\n${bioFacts.trim()}`);
  }

  if (vocabulary) {
    const vocabLines = [
      formatList('Words/phrases they use often', vocabulary.uses_often),
      formatList('Words they never use', vocabulary.never_uses),
      formatList('Signature phrases', vocabulary.signature_phrases),
    ].filter(Boolean);
    if (vocabLines.length > 0) {
      sections.push(`VOCABULARY FINGERPRINT:\n${vocabLines.join('\n')}`);
    }
  }

  if (structural) {
    const structLines = [
      structural.avg_sentence_length
        ? `Sentence length: ${structural.avg_sentence_length}`
        : '',
      structural.paragraph_style ? `Paragraphs: ${structural.paragraph_style}` : '',
      structural.hook_pattern ? `How they open: ${structural.hook_pattern}` : '',
      structural.closing_pattern ? `How they close: ${structural.closing_pattern}` : '',
    ].filter(Boolean);
    if (structLines.length > 0) {
      sections.push(`STRUCTURAL PATTERNS:\n${structLines.join('\n')}`);
    }
  }

  if (samplePosts?.length) {
    const examples = samplePosts
      .map((s, i) => {
        const tag = s.platform ? ` (${s.platform})` : '';
        return `Example ${i + 1}${tag}:\n${s.content.trim()}`;
      })
      .join('\n\n');
    sections.push(
      `VOICE EXAMPLES (match rhythm, tone, and structure — do not copy topics verbatim):\n${examples}`,
    );
  }

  if (brainSnippets?.length) {
    sections.push(
      `CREATOR BRAIN (your long-term memory on Dispatch):\n${brainSnippets.join('\n---\n')}`,
    );
  }

  if (memorySnippets?.length) {
    sections.push(
      `SEMANTIC MEMORY:\n${memorySnippets.join('\n---\n')}`,
    );
  }

  return sections.join('\n\n');
}

/**
 * Loads creator profile + Voice Lab settings + optional semantic memory into one context object.
 * All generation routes should use this instead of ad-hoc profile queries.
 */
export async function loadCreatorVoiceContext(
  client: InsforgeClient,
  userId: string,
  options: LoadVoiceContextOptions = {},
): Promise<CreatorVoiceContext> {
  const maxSamples = options.maxSamples ?? 3;
  let profile: CreatorProfileForPrompt | null = null;
  let bioFacts: string | undefined;
  let vocabulary: VocabularyFingerprint | undefined;
  let structural: StructuralPatterns | undefined;
  let samplePosts: VoiceSample[] | undefined;
  let userContext: string | undefined;

  try {
    const { data: profileRow } = await client.database
      .from('creator_profile')
      .select(
        'display_name, bio, bio_facts, content_pillars, voice_description, voice_rules',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (profileRow) {
      const contentPillars =
        typeof profileRow.content_pillars === 'string'
          ? JSON.parse(profileRow.content_pillars)
          : profileRow.content_pillars;

      bioFacts = profileRow.bio_facts?.trim() || undefined;
      profile = {
        display_name: profileRow.display_name,
        bio: profileRow.bio ?? undefined,
        bio_facts: bioFacts,
        content_pillars: contentPillars,
        voice_description: profileRow.voice_description?.trim() || undefined,
        voice_rules: profileRow.voice_rules?.trim() || undefined,
      };
    }
  } catch {
    // No profile
  }

  try {
    const { data: settingsRows } = await client.database
      .from('user_settings')
      .select('key, value')
      .eq('user_id', userId)
      .in('key', [
        'context_additions',
        'vocabulary_fingerprint',
        'structural_patterns',
        'sample_posts',
        'persona_prompt_export',
      ]);

    if (settingsRows) {
      for (const row of settingsRows) {
        switch (row.key) {
          case 'context_additions':
            userContext = row.value ?? undefined;
            break;
          case 'vocabulary_fingerprint':
            vocabulary = parseJsonSetting<VocabularyFingerprint>(row.value);
            break;
          case 'structural_patterns':
            structural = parseJsonSetting<StructuralPatterns>(row.value);
            break;
          case 'sample_posts':
            samplePosts = parseJsonSetting<VoiceSample[]>(row.value);
            break;
          default:
            break;
        }
      }
    }
  } catch {
    // Settings optional
  }

  if (samplePosts && samplePosts.length > maxSamples) {
    samplePosts = samplePosts.slice(0, maxSamples);
  }

  let brainSnippets: string[] | undefined;
  try {
    const brain = await retrieveBrainContext(client, userId, options.memoryQuery);
    if (brain.length > 0) {
      brainSnippets = brain;
    }
  } catch {
    // Brain table may not exist until migration applied
  }

  let memorySnippets: string[] | undefined;
  if (options.memoryQuery?.trim() && process.env.SUPERMEMORY_API_KEY) {
    try {
      const results = await searchUserContext(userId, options.memoryQuery.trim(), 3);
      const snippets = results.map((r) => r.content).filter((c): c is string => Boolean(c));
      if (snippets.length > 0) {
        memorySnippets = snippets;
      }
    } catch {
      // Supermemory optional enhancement
    }
  }

  const contextAdditions = buildVoiceContextAdditions({
    bioFacts,
    vocabulary,
    structural,
    samplePosts,
    brainSnippets,
    memorySnippets,
    userContext,
  });

  return { profile, contextAdditions };
}
