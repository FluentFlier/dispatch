import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { ensureActiveWorkspaceId } from '@/lib/workspace';
import { detectTrendsForUser } from '@/lib/trends/detect';

export async function POST(_request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await ensureActiveWorkspaceId(user.id);
  const result = await detectTrendsForUser(client, user.id, workspaceId);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    result.message ? { trends: result.trends ?? [], message: result.message } : { trends: result.trends },
  );
}
