import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { syncEngagementComments } from '@/lib/engagement/sync';
import { z } from 'zod';

const ManualCommentSchema = z.object({
  post_id: z.string().uuid(),
  platform: z.string().min(1),
  provider_comment_id: z.string().min(1),
  comment_text: z.string().min(1),
  author_name: z.string().optional(),
  author_handle: z.string().optional(),
  author_headline: z.string().optional(),
  commented_at: z.string().optional(),
  parent_provider_comment_id: z.string().optional(),
});

const SyncSchema = z
  .object({
    postIds: z.array(z.string().uuid()).optional(),
    manual: z.array(ManualCommentSchema).optional(),
    fetchFromProvider: z.boolean().optional(),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = SyncSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  if (
    !parsed.data.manual?.length &&
    parsed.data.fetchFromProvider === false &&
    !parsed.data.postIds?.length
  ) {
    return NextResponse.json(
      {
        error:
          'Provide manual comments, postIds for provider sync, or omit fetchFromProvider to use defaults',
      },
      { status: 400 },
    );
  }

  const client = getServerClient();

  try {
    const result = await syncEngagementComments(client, user.id, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('Engagement sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
