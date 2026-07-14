import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { ingestManualPost } from '@/lib/signals/sync';
import { errorResponse } from '@/lib/api-errors';

const SeedSchema = z.object({
  content: z.string().min(20).max(4000),
  platform: z.enum(['x', 'linkedin']).optional(),
  author_handle: z.string().max(120).optional(),
  author_name: z.string().max(120).optional(),
}).strict();

/** POST /api/signals/seed - dev/demo ingest without Apify */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production' && process.env.SIGNALS_ALLOW_SEED !== 'true') {
    return NextResponse.json({ error: 'Seed disabled in production' }, { status: 403 });
  }

  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof SeedSchema>;
  try {
    body = SeedSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const result = await ingestManualPost(client, workspaceId, {
      platform: body.platform ?? 'x',
      externalPostId: `seed-${Date.now()}`,
      authorHandle: body.author_handle ?? 'founder',
      authorName: body.author_name ?? 'Demo Founder',
      content: body.content,
      postUrl: body.platform === 'linkedin' ? 'https://linkedin.com/feed' : 'https://x.com/demo',
    });

    return NextResponse.json({ result }, { status: result.created ? 201 : 200 });
  } catch (err) {
    return errorResponse('Could not seed signal.', 500, err);
  }
}
