import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { syncCreatorBrainFull } from '@/lib/brain/sync';

export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();

  try {
    const result = await syncCreatorBrainFull(client, user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('Brain sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
