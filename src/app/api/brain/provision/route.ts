import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { provisionCreatorBrain, syncBrainFromProfile } from '@/lib/brain/sync';

export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();

  try {
    const result = await provisionCreatorBrain(client, user.id);
    await syncBrainFromProfile(client, user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Brain provision error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Provision failed' },
      { status: 500 },
    );
  }
}
