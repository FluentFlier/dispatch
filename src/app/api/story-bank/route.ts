import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let query = client
    .database.from('story_bank')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  // Scope to the active workspace (rows are backfilled with workspace_id).
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data, error } = await query;
  if (error) return errorResponse('Could not load stories.', 500, error);
  return NextResponse.json({ stories: data });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const StorySchema = z.object({
    title: z.string().min(1).max(500),
    body: z.string().max(10000).optional(),
    category: z.string().max(200).optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
    source: z.string().max(500).optional(),
  });

  const parsed = StorySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const { data, error } = await client
    .database.from('story_bank')
    .insert([{ ...parsed.data, user_id: user.id, workspace_id: workspaceId }])
    .select()
    .single();

  if (error) return errorResponse('Could not save story.', 500, error);

  // L3: write captured stories into memory so raw memory dumps inform future
  // drafts by semantic search, not only via the Story Bank angle injection.
  try {
    const storyContent = (parsed.data.body ?? parsed.data.title).trim();
    const storyId = (data as { id?: string } | null)?.id;
    if (storyContent && storyId) {
      const { writeToMemory } = await import('@/lib/memory/write');
      await writeToMemory(client, {
        userId: user.id,
        workspaceId,
        kind: 'story_bank',
        content: storyContent,
        customId: `story_${storyId}`,
        metadata: { category: parsed.data.category ?? '' },
      });
    }
  } catch (err) {
    console.error('[story-bank] memory write failed (non-blocking):', err);
  }

  return NextResponse.json({ story: data }, { status: 201 });
}
