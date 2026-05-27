import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getBrainStatus } from '@/lib/brain/pages';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();

  try {
    const status = await getBrainStatus(client, user.id);
    return NextResponse.json({
      provisioned: status.page_count > 0,
      ...status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brain unavailable';
    if (message.includes('creator_brain_pages') || message.includes('does not exist')) {
      return NextResponse.json({
        provisioned: false,
        page_count: 0,
        slugs: [],
        last_updated: null,
        migration_required: true,
        message: 'Run db/creator-brain.sql on InsForge',
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
