import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { listBrainPages } from '@/lib/brain/pages';
import { buildBrainGraph } from '@/lib/brain/graph';
import { deriveBrainInsights } from '@/lib/brain/insights';
import {
  deriveContentLearnings,
  deriveLeadFitLearnings,
  type LeadSignal,
  type LearningPost,
} from '@/lib/brain/learnings';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * Returns the creator's brain as a node/edge graph for visualization.
 * Scoped to the active workspace so agency clients never see each other's brain.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();

  try {
    const workspaceId = (await getActiveWorkspaceId(user.id)) ?? undefined;
    const pages = await listBrainPages(client, user.id, workspaceId);
    const graph = buildBrainGraph(pages);
    const insights = deriveBrainInsights(pages, graph);

    // Content-intelligence learnings need richer per-post metrics than the brain
    // pages carry, so pull posted rows straight from `posts`.
    let postsQuery = client.database
      .from('posts')
      .select(
        'id, pillar, platform, hook, views, likes, comments, shares, saves, follows_gained, voice_match_score, posted_date',
      )
      .eq('user_id', user.id)
      .eq('status', 'posted')
      .order('posted_date', { ascending: false })
      .limit(500);
    if (workspaceId) postsQuery = postsQuery.eq('workspace_id', workspaceId);
    const { data: postRows } = await postsQuery;
    const learnings = deriveContentLearnings((postRows ?? []) as LearningPost[], graph);

    // Content ↔ pipeline fit - leads are strictly workspace-scoped.
    let pipelineLearnings: ReturnType<typeof deriveLeadFitLearnings> = [];
    if (workspaceId) {
      const { data: leadRows } = await client.database
        .from('signal_leads')
        .select('tags, intent_flags')
        .eq('workspace_id', workspaceId)
        .limit(1000);
      const leads: LeadSignal[] = (leadRows ?? []).map((r) => ({
        tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
        intent_flags:
          r.intent_flags && typeof r.intent_flags === 'object'
            ? (r.intent_flags as Record<string, boolean>)
            : {},
      }));
      pipelineLearnings = deriveLeadFitLearnings(leads, graph);
    }

    return NextResponse.json({
      provisioned: pages.length > 0,
      page_count: pages.length,
      last_updated: pages[0]?.updated_at ?? null,
      insights,
      learnings,
      pipeline_learnings: pipelineLearnings,
      ...graph,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brain unavailable';
    if (message.includes('creator_brain_pages') || message.includes('does not exist')) {
      return NextResponse.json({
        provisioned: false,
        page_count: 0,
        last_updated: null,
        nodes: [],
        edges: [],
        migration_required: true,
        message: 'Run db/creator-brain.sql on InsForge',
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
