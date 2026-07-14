import type { createClient } from '@insforge/sdk';
import type { BrainGraph } from './graph';
import { deriveContentLearnings, type ContentLearning, type LearningPost } from './learnings';

type InsforgeClient = ReturnType<typeof createClient>;

const EMPTY_GRAPH: BrainGraph = { nodes: [], edges: [] };

function quoted(headline: string): string | null {
  return headline.match(/"([^"]+)"/)?.[1] ?? null;
}

/** Turn a display learning into an imperative directive the model can act on. */
function directiveFor(learning: ContentLearning): string | null {
  switch (learning.id) {
    case 'pillar-strong': {
      const p = quoted(learning.headline);
      return p ? `Your strongest-performing angle is "${p}" — favor it when the brief allows.` : null;
    }
    case 'pillar-weak': {
      const p = quoted(learning.headline);
      return p ? `Your "${p}" angle underperforms — avoid it unless the brief calls for it.` : null;
    }
    case 'hook-question':
      return 'Question-style hooks outperform for you — open with a question when it fits.';
    case 'hook-statement':
      return 'Declarative statement hooks outperform for you — a strong, confident opener works well.';
    case 'hook-number':
      return 'Numbered / list hooks ("N ways…", "3 things…") perform well for you — consider that framing.';
    default:
      // timing/platform/voice/pipeline learnings aren't actionable for a single draft.
      return null;
  }
}

/**
 * Formats the draft-relevant content learnings into a generation-context block.
 * Pure and deterministic; returns '' when nothing is actionable.
 */
export function formatBrainGuidance(learnings: ContentLearning[]): string {
  const lines = learnings.map(directiveFor).filter((l): l is string => Boolean(l));
  if (lines.length === 0) return '';
  return `\n\nWHAT WORKS FOR THIS CREATOR (evidence from their own top posts — apply when it fits the brief, never force):\n${lines
    .map((l) => `- ${l}`)
    .join('\n')}`;
}

/**
 * Loads the creator's published posts and distills what's working into a compact
 * guidance block for the generation prompt. Never throws — degrades to ''.
 */
export async function getBrainGuidanceForGeneration(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<string> {
  try {
    let query = client.database
      .from('posts')
      .select(
        'id, pillar, platform, hook, views, likes, comments, shares, saves, follows_gained, voice_match_score, posted_date',
      )
      .eq('user_id', userId)
      .eq('status', 'posted')
      .order('posted_date', { ascending: false })
      .limit(500);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    const { data } = await query;
    const learnings = deriveContentLearnings((data ?? []) as LearningPost[], EMPTY_GRAPH);
    return formatBrainGuidance(learnings);
  } catch {
    return '';
  }
}
