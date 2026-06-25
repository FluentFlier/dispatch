import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/event-capture/[id]
 * Returns a single event capture with its research and generated posts (if drafted).
 * This is the polling target — the UI polls every 3 seconds while status='drafting'
 * to detect when drafts are ready and render them.
 *
 * Validates workspace ownership before returning — prevents cross-workspace data leaks.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const client = getServerClient();

  const { data: capture, error } = await client.database
    .from('event_captures')
    .select(
      'id, workspace_id, title, description, location, start_time, end_time, event_type, is_public_event, questions, answers, status, dismissed_at, created_at, updated_at',
    )
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (error || !capture) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
  }

  // --- Fetch research if available ---
  const { data: research } = await client.database
    .from('event_research')
    .select('summary, speakers, key_topics, key_announcements, sources')
    .eq('event_capture_id', params.id)
    .maybeSingle();

  // --- Fetch generated posts if drafted ---
  let posts: unknown[] = [];
  if ((capture as { status: string }).status === 'drafted') {
    const { data: postData } = await client.database
      .from('posts')
      .select('id, platform, script, caption, status, created_at')
      .eq('event_capture_id', params.id)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    posts = postData ?? [];
  }

  return NextResponse.json({
    capture,
    research: research ?? null,
    posts,
  });
}
