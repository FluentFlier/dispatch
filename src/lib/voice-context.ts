import type { createClient } from '@insforge/sdk';
import type { CreatorProfileForPrompt } from '@/lib/ai';
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

/**
 * Which context sources actually resolved with content for this load. Lets the
 * caller (and UI) react to a starved prompt instead of silently generating on
 * near-empty context. `starved` is a coarse "onboarding likely incomplete" flag.
 */
export interface ContextCompleteness {
  profile: boolean;
  fingerprint: boolean;
  structural: boolean;
  voiceExamples: boolean;
  brain: boolean;
  semanticMemory: boolean;
  storyBank: boolean;
  l4Metrics: boolean;
  starved: boolean;
}

export interface CreatorVoiceContext {
  profile: CreatorProfileForPrompt | null;
  contextAdditions: string;
  completeness: ContextCompleteness;
}

interface LoadVoiceContextOptions {
  /** Topic or post idea; triggers Supermemory retrieval when set */
  memoryQuery?: string;
  /** Skip brain, Supermemory, story bank, and L4 metrics (faster outreach drafts) */
  lightweight?: boolean;
  /** Max few-shot samples injected into the prompt */
  maxSamples?: number;
  /**
   * Active workspace ID. When set, profile + settings queries are scoped
   * to the workspace so each client workspace has its own trained voice.
   * Falls back to user_id-only lookup when null (pre-migration rows).
   */
  workspaceId?: string;
  /**
   * Publishing platform (linkedin|twitter|threads). When set alongside workspaceId,
   * L4 voice metrics baseline is injected so generation targets the user's own score.
   */
  platform?: string;
  /**
   * Include the GTM playbook (ICP/pitch/CTA) from the brain. Only for OUTREACH
   * generation (signals/reply drafts). Default false so sales context never bleeds
   * into ordinary content posts.
   */
  includeGtm?: boolean;
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
  emailSamples,
  brainSnippets,
  memorySnippets,
  userContext,
}: {
  bioFacts?: string;
  vocabulary?: VocabularyFingerprint;
  structural?: StructuralPatterns;
  samplePosts?: VoiceSample[];
  emailSamples?: VoiceSample[];
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
      `VOICE EXAMPLES (match rhythm, tone, and structure; do not copy topics verbatim):\n${examples}`,
    );
  }

  if (emailSamples?.length) {
    const examples = emailSamples
      .map((s, i) => `Email ${i + 1}:\n${s.content.trim()}`)
      .join('\n\n');
    sections.push(
      `EMAIL VOICE (how they write 1:1 — match warmth, explanation style, sign-offs):\n${examples}`,
    );
  }

  if (brainSnippets?.length) {
    sections.push(
      `CREATOR BRAIN (your long-term memory on Content OS):\n${brainSnippets.join('\n---\n')}`,
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
  let emailSamples: VoiceSample[] | undefined;
  let userContext: string | undefined;

  try {
    let profileQuery = client.database
      .from('creator_profile')
      .select('display_name, bio, bio_facts, content_pillars, voice_description, voice_rules')
      .eq('user_id', userId);
    if (options.workspaceId) profileQuery = profileQuery.eq('workspace_id', options.workspaceId);

    let settingsQuery = client.database
      .from('user_settings')
      .select('key, value')
      .eq('user_id', userId)
      .in('key', ['context_additions', 'vocabulary_fingerprint', 'structural_patterns', 'sample_posts', 'sample_emails', 'voice_analysis_samples', 'persona_prompt_export']);
    if (options.workspaceId) settingsQuery = settingsQuery.eq('workspace_id', options.workspaceId);

    const [{ data: profileRow }, { data: settingsRows }] = await Promise.all([
      profileQuery.maybeSingle(),
      settingsQuery,
    ]);

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
          case 'sample_emails':
            emailSamples = parseJsonSetting<VoiceSample[]>(row.value);
            break;
          case 'voice_analysis_samples':
            if (!samplePosts?.length) {
              samplePosts = parseJsonSetting<VoiceSample[]>(row.value);
            }
            break;
          default:
            break;
        }
      }
    }
  } catch (err) {
    // Profile and settings optional, but a THROW here (vs. an empty result) is a
    // real failure worth surfacing — it starves every downstream stage.
    console.warn('[voice-context] profile/settings load failed', {
      userId,
      workspaceId: options.workspaceId,
      err,
    });
  }

  if (samplePosts && samplePosts.length > maxSamples) {
    samplePosts = samplePosts.slice(0, maxSamples);
  }
  if (emailSamples && emailSamples.length > 2) {
    emailSamples = emailSamples.slice(0, 2);
  }

  let brainSnippets: string[] | undefined;
  // Lightweight mode skips brain retrieval for speed, but the GTM playbook lives
  // in the brain and outreach drafts need it, so still fetch when includeGtm is set.
  if (!options.lightweight || options.includeGtm) {
    try {
      const brain = await retrieveBrainContext(
        client,
        userId,
        options.memoryQuery,
        options.workspaceId,
        options.includeGtm ?? false,
      );
      if (brain.length > 0) {
        brainSnippets = brain;
      }
    } catch (err) {
      // Brain table may not exist until migration applied — log so a persistent
      // failure is visible instead of silently thinning the prompt.
      console.warn('[voice-context] brain retrieval failed', { userId, err });
    }
  }

  let memorySnippets: string[] | undefined;
  if (
    !options.lightweight &&
    options.memoryQuery?.trim() &&
    process.env.SUPERMEMORY_API_KEY
  ) {
    try {
      // Pass workspaceId so the READ tag (workspace_${ws}) matches the WRITE tag
      // used by onboarding persona + published-post storage. Without it the search
      // fell back to user_${userId} and never found workspace-scoped memories.
      const results = await searchUserContext(userId, options.memoryQuery.trim(), 3, options.workspaceId);
      const snippets = results.map((r) => r.content).filter((c): c is string => Boolean(c));
      if (snippets.length > 0) {
        memorySnippets = snippets;
      }
    } catch (err) {
      // Supermemory optional enhancement — log so an auth/quota failure is visible.
      console.warn('[voice-context] supermemory search failed', { userId, err });
    }
  }

  let contextAdditions = buildVoiceContextAdditions({
    bioFacts,
    vocabulary,
    structural,
    samplePosts,
    emailSamples,
    brainSnippets,
    memorySnippets,
    userContext,
  });

  // L3: inject unused Story Bank angles so captured memories inform new drafts
  let storyBankUsed = false;
  if (options.workspaceId && !options.lightweight) {
    try {
      const { data: storyRows } = await client.database
        .from('story_bank')
        .select('mined_angle, pillar')
        .eq('user_id', userId)
        .eq('workspace_id', options.workspaceId)
        .eq('used', false)
        .not('mined_angle', 'is', null)
        .order('created_at', { ascending: false })
        .limit(3);

      if (storyRows?.length) {
        storyBankUsed = true;
        contextAdditions +=
          '\n\nUNUSED STORY BANK ANGLES (consider weaving into this draft):\n' +
          storyRows.map((s, i) => `${i + 1}. ${s.mined_angle}`).join('\n');
      }
    } catch (err) {
      // Story bank optional — log the failure rather than dropping the angles silently.
      console.warn('[voice-context] story bank load failed', {
        workspaceId: options.workspaceId,
        err,
      });
    }
  }

  // L4: inject voice quality baseline so generation targets the user's own standard
  let l4MetricsUsed = false;
  if (options.workspaceId && options.platform && !options.lightweight) {
    try {
      const { data: metrics } = await client.database
        .from('workspace_voice_metrics')
        .select('avg_voice_match_score, avg_ai_score, post_count')
        .eq('workspace_id', options.workspaceId)
        .eq('platform', options.platform)
        .maybeSingle();

      if (metrics && Number(metrics.post_count) >= 3) {
        l4MetricsUsed = true;
        // Stable "PERFORMANCE BASELINE:" prefix so the substance allow-list can
        // let this baseline shape the draft from the first pass (break 24), not
        // only the late Stage 4 voice rewrite.
        contextAdditions +=
          `\n\nPERFORMANCE BASELINE:\nYour recent ${options.platform} performance: ` +
          `${Number(metrics.avg_voice_match_score).toFixed(0)}/100 voice match, ` +
          `${Number(metrics.avg_ai_score).toFixed(0)}/100 AI detection ` +
          `(${metrics.post_count} posts). Maintain or beat these scores.`;
      }
    } catch (err) {
      // Metrics optional — log so a persistent read failure is visible.
      console.warn('[voice-context] L4 metrics load failed', {
        workspaceId: options.workspaceId,
        platform: options.platform,
        err,
      });
    }
  }

  // Completeness signal: which sources actually landed content. `starved` fires
  // when the two strongest voice signals (fingerprint + examples) are BOTH absent,
  // which almost always means Voice Lab onboarding never ran for this workspace.
  const completeness: ContextCompleteness = {
    profile: !!profile,
    fingerprint: !!vocabulary,
    structural: !!structural,
    voiceExamples: !!samplePosts?.length,
    brain: !!brainSnippets?.length,
    semanticMemory: !!memorySnippets?.length,
    storyBank: storyBankUsed,
    l4Metrics: l4MetricsUsed,
    starved: !vocabulary && !samplePosts?.length,
  };

  if (completeness.starved) {
    console.warn('[voice-context] starved prompt: no fingerprint or voice examples', {
      userId,
      workspaceId: options.workspaceId,
      hasProfile: completeness.profile,
    });
  }

  return { profile, contextAdditions, completeness };
}
