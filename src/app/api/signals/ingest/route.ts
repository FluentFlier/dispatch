import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceClient } from '@/lib/insforge/server';
import { getIngestSecret } from '@/lib/signals/ingest/config';
import { ingestSinglePost } from '@/lib/signals/ingest/process-batch';
import type { IngestedPost } from '@/lib/signals/types';
import { errorResponse } from '@/lib/api-errors';

const PostSchema = z.object({
  platform: z.enum(['x', 'linkedin']),
  content: z.string().min(20).max(8000),
  external_post_id: z.string().min(1).max(200).optional(),
  author_handle: z.string().max(120).optional(),
  author_name: z.string().max(120).optional(),
  post_url: z.string().url().max(500).optional(),
  posted_at: z.string().max(40).optional(),
  source_id: z.string().uuid().optional(),
}).strict();

const IngestSchema = z.union([
  PostSchema.extend({ workspace_id: z.string().uuid() }),
  z.object({
    workspace_id: z.string().uuid(),
    posts: z.array(PostSchema).min(1).max(20),
  }).strict(),
]);

function authorize(request: NextRequest): boolean {
  const secret = getIngestSecret();
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

function toIngestedPost(body: z.infer<typeof PostSchema>): IngestedPost {
  const handle = body.author_handle?.replace(/^@/, '') ?? 'unknown';
  return {
    platform: body.platform,
    externalPostId: body.external_post_id ?? `webhook-${Date.now()}-${handle}`,
    authorHandle: handle,
    authorName: body.author_name,
    content: body.content,
    postUrl: body.post_url,
    postedAt: body.posted_at,
    rawPayload: { source: 'webhook' },
  };
}

/**
 * POST /api/signals/ingest
 * Push ingest for Clay, Zapier, Make, or custom scrapers.
 * Auth: Bearer SIGNALS_INGEST_SECRET (falls back to CRON_SECRET).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof IngestSchema>;
  try {
    body = IngestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const workspaceId = body.workspace_id;
  const posts =
    'posts' in body
      ? body.posts.map(toIngestedPost)
      : [toIngestedPost(body)];

  const sourceId = 'posts' in body ? undefined : body.source_id;

  try {
    const client = getServiceClient();
    const results = await Promise.all(
      posts.map((post) => ingestSinglePost(client, workspaceId, post, sourceId ?? null)),
    );

    const created = results.filter((r) => r.created).length;
    return NextResponse.json(
      {
        ok: true,
        received: posts.length,
        signals_created: created,
        results,
      },
      { status: created > 0 ? 201 : 200 },
    );
  } catch (err) {
    return errorResponse('Ingest failed.', 500, err);
  }
}
