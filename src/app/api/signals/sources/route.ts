import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { ensureDefaultSources, ensureGtmPlaybook, listSources } from '@/lib/signals/store';
import { errorResponse } from '@/lib/api-errors';

const CreateSourceSchema = z.object({
  platform: z.enum(['x', 'linkedin']),
  handle_or_url: z.string().min(1).max(500),
  source_type: z
    .enum(['account', 'company_page', 'person_profile', 'keyword_search'])
    .optional(),
  label: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
}).strict();

/**
 * Runaway guard only, NOT a product limit. The user (or the ICP assistant on
 * their behalf) decides how many topics are worth monitoring; this just stops a
 * malformed batch from arming hundreds of hourly X searches. Mirror of the
 * constant in lib/signals/leads/topic-sync.ts.
 */
const MAX_KEYWORD_SOURCES = 50;

/** Keyword searches poll hourly by default (profiles default to 30 min). */
const KEYWORD_POLL_INTERVAL_MINUTES = 60;

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    await ensureDefaultSources(client, workspaceId);
    await ensureGtmPlaybook(client, user.id, workspaceId);
    const sources = await listSources(client, workspaceId);
    return NextResponse.json({ sources });
  } catch (err) {
    return errorResponse('Could not load sources.', 500, err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof CreateSourceSchema>;
  try {
    body = CreateSourceSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const isKeyword = body.source_type === 'keyword_search';

    if (isKeyword) {
      const { data: existing } = await client.database
        .from('signal_sources')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('source_type', 'keyword_search');
      if ((existing?.length ?? 0) >= MAX_KEYWORD_SOURCES) {
        return NextResponse.json(
          { error: `You can monitor up to ${MAX_KEYWORD_SOURCES} topics. Remove one to add another.` },
          { status: 422 },
        );
      }
    }

    const { data, error } = await client.database
      .from('signal_sources')
      .insert({
        workspace_id: workspaceId,
        platform: body.platform,
        handle_or_url: body.handle_or_url.trim(),
        source_type: body.source_type ?? 'account',
        label: body.label ?? null,
        enabled: body.enabled ?? true,
        ...(isKeyword ? { poll_interval_minutes: KEYWORD_POLL_INTERVAL_MINUTES } : {}),
      })
      .select('*')
      .single();

    if (error) return errorResponse('Could not create source.', 500, error);
    return NextResponse.json({ source: data }, { status: 201 });
  } catch (err) {
    return errorResponse('Could not create source.', 500, err);
  }
}
