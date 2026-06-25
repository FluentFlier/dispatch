import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = request.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let query = client.database.from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .eq('key', key);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data, error } = await query.single();

  if (error) return errorResponse('Setting not found.', 404, error);
  return NextResponse.json({ setting: data });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const SettingSchema = z.object({
    key: z.string().min(1).max(255),
    value: z.unknown(),
  });

  const parsed = SettingSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const { key, value } = parsed.data;

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  const { data, error } = await client
    .database.from('user_settings')
    .upsert(
      { user_id: user.id, workspace_id: workspaceId ?? null, key, value },
      { onConflict: 'user_id,key' }
    )
    .select()
    .single();

  if (error) return errorResponse('Could not save setting.', 500, error);
  return NextResponse.json({ setting: data });
}
