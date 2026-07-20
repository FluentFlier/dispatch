import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { putBrainPage } from '@/lib/brain/pages';
import { fetchNotionSources } from '@/lib/notion/mcp';
import { getNotionConnection, updateNotionConnection } from '@/lib/notion/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SyncSchema = z.object({ source_urls: z.array(z.string().trim().url()).min(1).max(8) });

function isNotionUrl(raw: string): boolean {
  const host = new URL(raw).hostname.toLowerCase();
  return host === 'notion.so' || host.endsWith('.notion.so') ||
    host === 'notion.site' || host.endsWith('.notion.site') ||
    host === 'notion.com' || host.endsWith('.notion.com');
}

function sourceSlug(url: string): string {
  return `notion-${createHash('sha256').update(url).digest('hex').slice(0, 20)}`;
}

function sourceTitle(content: string, sourceUrl: string): string {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    for (const key of ['title', 'name']) {
      if (typeof value[key] === 'string' && value[key]) return `Notion: ${value[key]}`;
    }
  } catch { /* markdown or other text payload */ }
  const path = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() ?? 'page';
  return `Notion: ${decodeURIComponent(path).replace(/[-_]/g, ' ').slice(0, 80)}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = SyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.source_urls.every(isNotionUrl)) {
    return NextResponse.json({ error: 'Add 1–8 valid Notion page or database URLs.' }, { status: 400 });
  }
  const sourceUrls = Array.from(new Set(parsed.data.source_urls));
  const connection = await getNotionConnection(workspaceId);
  if (!connection) return NextResponse.json({ error: 'Connect Notion first.' }, { status: 409 });

  try {
    const sources = await fetchNotionSources(connection, sourceUrls);
    const client = getServerClient();
    for (const source of sources) {
      await putBrainPage(client, user.id, {
        slug: sourceSlug(source.sourceUrl),
        title: sourceTitle(source.content, source.sourceUrl),
        tags: ['notion', 'imported', 'context'],
        body: `Source: ${source.sourceUrl}\nSynced: ${new Date().toISOString()}\n\n${source.content.slice(0, 50_000)}`,
        workspaceId,
      });
    }

    const removedSlugs = connection.source_urls
      .filter((url) => !sourceUrls.includes(url))
      .map(sourceSlug);
    if (removedSlugs.length) {
      await client.database.from('creator_brain_pages').delete()
        .eq('user_id', user.id).eq('workspace_id', workspaceId).in('slug', removedSlugs);
    }

    const syncedAt = new Date().toISOString();
    await updateNotionConnection(workspaceId, {
      source_urls: sourceUrls, last_synced_at: syncedAt, last_sync_error: null,
    });
    return NextResponse.json({ ok: true, imported: sources.length, last_synced_at: syncedAt });
  } catch (error) {
    const reauth = error instanceof Error && error.message === 'NOTION_REAUTH_REQUIRED';
    const message = reauth ? 'Your Notion authorization expired. Reconnect Notion.' : 'Could not sync Notion context.';
    await updateNotionConnection(workspaceId, { last_sync_error: message }).catch(() => undefined);
    console.error('[notion:mcp] sync failed', error);
    return NextResponse.json({ error: message, reauth_required: reauth }, { status: reauth ? 401 : 502 });
  }
}
