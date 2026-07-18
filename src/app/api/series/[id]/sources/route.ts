import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';
import { loadSeries } from '@/lib/series/db';
import { ingestSource } from '@/lib/series/ingest';
import { fetchUrlText } from '@/lib/series/url-fetch';

export const maxDuration = 120;

/** Bound sources per series (each carries embedded chunks). */
const MAX_SOURCES = 20;
/** URL sources are the expensive, failure-prone kind - cap harder. */
const MAX_URL_SOURCES = 5;

const SourceSchema = z.union([
  z.object({ kind: z.literal('text'), title: z.string().max(200).optional(), text: z.string().min(1).max(200000) }),
  z.object({ kind: z.literal('file'), title: z.string().max(200), text: z.string().min(1).max(200000) }),
  z.object({ kind: z.literal('url'), url: z.string().url().max(2000) }),
  z.object({ kind: z.literal('story_bank'), id: z.string().uuid() }),
  z.object({ kind: z.literal('post'), id: z.string().uuid() }),
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const series = await loadSeries(client, params.id, user.id, workspaceId);
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });

  const { data, error } = await client.database
    .from('series_sources')
    .select('id, series_id, kind, title, source_ref, char_count, status, error, created_at')
    .eq('series_id', params.id)
    .order('created_at', { ascending: true });
  if (error) return errorResponse('Could not load sources.', 500, error);
  return NextResponse.json({ sources: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = SourceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const series = await loadSeries(client, params.id, user.id, workspaceId);
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });

  // Enforce per-series source caps.
  const { data: existing } = await client.database
    .from('series_sources')
    .select('kind')
    .eq('series_id', params.id);
  const rows = (existing ?? []) as { kind: string }[];
  if (rows.length >= MAX_SOURCES) {
    return NextResponse.json({ error: `Source limit reached (${MAX_SOURCES}).` }, { status: 400 });
  }
  if (parsed.data.kind === 'url' && rows.filter((r) => r.kind === 'url').length >= MAX_URL_SOURCES) {
    return NextResponse.json({ error: `URL source limit reached (${MAX_URL_SOURCES}).` }, { status: 400 });
  }

  // Normalize each input kind to plain text + a title/ref before the shared ingest.
  let rawText = '';
  let title: string | undefined;
  let sourceRef: string | undefined;
  const input = parsed.data;

  try {
    if (input.kind === 'text') {
      rawText = input.text;
      title = input.title ?? 'Pasted notes';
    } else if (input.kind === 'file') {
      rawText = input.text;
      title = input.title;
      sourceRef = input.title;
    } else if (input.kind === 'url') {
      const fetched = await fetchUrlText(input.url);
      if (!fetched.ok) {
        return NextResponse.json({ error: fetched.error }, { status: 502 });
      }
      rawText = fetched.text;
      title = fetched.title ?? input.url;
      sourceRef = input.url;
    } else if (input.kind === 'story_bank') {
      const { data } = await client.database
        .from('story_bank')
        .select('title, body')
        .eq('id', input.id)
        .eq('user_id', user.id)
        .single();
      if (!data) return NextResponse.json({ error: 'Story not found' }, { status: 404 });
      const s = data as { title?: string; body?: string };
      rawText = [s.title, s.body].filter(Boolean).join('\n\n');
      title = s.title ?? 'Story';
      sourceRef = input.id;
    } else { // post
      const { data } = await client.database
        .from('posts')
        .select('title, script, caption, hook')
        .eq('id', input.id)
        .eq('user_id', user.id)
        .single();
      if (!data) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      const p = data as { title?: string; script?: string; caption?: string; hook?: string };
      rawText = [p.hook, p.script, p.caption].filter(Boolean).join('\n\n');
      title = p.title ?? 'Post';
      sourceRef = input.id;
    }

    const result = await ingestSource(client, {
      seriesId: params.id,
      userId: user.id,
      workspaceId,
      kind: input.kind,
      title,
      sourceRef,
      rawText,
    });
    return NextResponse.json({ source: result }, { status: 201 });
  } catch (err) {
    return errorResponse('Could not add source.', 500, err);
  }
}
