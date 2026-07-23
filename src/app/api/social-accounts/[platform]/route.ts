import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';

// DELETE: disconnect a social account
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { platform: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { platform } = params;
  const validPlatforms = ['instagram', 'linkedin', 'twitter', 'threads'];
  if (!validPlatforms.includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  const client = getServerClient();
  // `.select()` so the response reports what was actually removed. Without it a
  // delete that matched nothing (or was denied by RLS) still returned ok:true,
  // the client optimistically dropped the row from the list, and the account
  // reappeared - "Connected as <name>" - on the very next fetch.
  const { data, error } = await client.database
    .from('social_accounts')
    .delete()
    .eq('user_id', user.id)
    .eq('platform', platform)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deleted = (data as unknown[] | null)?.length ?? 0;
  if (deleted === 0) {
    return NextResponse.json({ error: 'No connected account to disconnect.' }, { status: 404 });
  }

  // Drop any live connect permit too: it is a 15-minute licence to bind an
  // account, and leaving it behind lets a disconnect silently re-bind.
  await client.database.from('unipile_connect_snapshots').delete().eq('user_id', user.id);

  return NextResponse.json({ ok: true, deleted });
}
