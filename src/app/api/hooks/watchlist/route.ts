import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';

const EntrySchema = z.object({
  handle: z.string().min(1).max(80),
  platform: z.enum(['x', 'linkedin']).default('x'),
  verticals: z.array(z.string().max(40)).max(5).optional(),
  priority: z.number().int().min(1).max(10).optional(),
});

/**
 * GET /api/hooks/watchlist — workspace hook-mining watchlist (Pro feature surface).
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ entries: [] });

  const client = getServerClient();
  const { data, error } = await client.database
    .from('workspace_watchlists')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('priority', { ascending: false });

  if (error) return errorResponse('Could not load watchlist.', 500, error);
  return NextResponse.json({ entries: data ?? [] });
}

/**
 * POST /api/hooks/watchlist — add or upsert a creator handle to mine for hooks.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = EntrySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const handle = parsed.data.handle.replace(/^@+/, '').trim();
  const client = getServerClient();
  const { data, error } = await client.database
    .from('workspace_watchlists')
    .upsert(
      {
        workspace_id: workspaceId,
        handle,
        platform: parsed.data.platform,
        verticals: parsed.data.verticals ?? ['general'],
        priority: parsed.data.priority ?? 5,
        enabled: true,
      },
      { onConflict: 'workspace_id,handle,platform' },
    )
    .select()
    .maybeSingle();

  if (error) return errorResponse('Could not save watchlist entry.', 500, error);
  return NextResponse.json({ entry: data });
}

/**
 * DELETE /api/hooks/watchlist?id= — remove a watchlist row.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const client = getServerClient();
  const { error } = await client.database
    .from('workspace_watchlists')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) return errorResponse('Could not delete watchlist entry.', 500, error);
  return NextResponse.json({ ok: true });
}
