import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getDirectorySettings, updateDirectorySettings } from '@/lib/signals/leads/store';
import { normalizeMeetingLink } from '@/lib/signals/leads/meeting-link';
import { errorResponse } from '@/lib/api-errors';
import type { DirectorySettingsRow } from '@/lib/signals/types';

/** GET /api/leads/settings - directory + digest config. */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const settings = await getDirectorySettings(client, workspaceId);
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse('Could not load settings.', 500, err);
  }
}

/**
 * PUT /api/leads/settings
 * Persists directory/ICP/digest settings (from the Advanced drawer + settings
 * page) and, when provided, the browser-detected workspace timezone.
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Partial<DirectorySettingsRow> & {
    timezone?: string;
  };

  try {
    const client = getServerClient();

    // Persist workspace timezone if the client detected one and it isn't set yet.
    if (body.timezone) {
      const { data: ws } = await client.database
        .from('workspaces')
        .select('timezone')
        .eq('id', workspaceId)
        .limit(1);
      const current = (ws?.[0] as { timezone: string | null } | undefined)?.timezone;
      if (!current) {
        await client.database.from('workspaces').update({ timezone: body.timezone }).eq('id', workspaceId);
      }
    }

    const { timezone: _tz, workspace_id: _wid, created_at: _c, updated_at: _u, ...patch } = body;
    if ('meeting_link' in patch) {
      const raw = patch.meeting_link as string | null | undefined;
      if (raw === null || raw === '') {
        patch.meeting_link = null;
      } else {
        const normalized = normalizeMeetingLink(String(raw));
        if (!normalized) {
          return NextResponse.json(
            { error: 'Enter a valid scheduling URL (Calendly, Google Calendar, Cal.com, etc.).' },
            { status: 422 },
          );
        }
        patch.meeting_link = normalized.url;
      }
    }
    if (Object.keys(patch).length > 0) {
      await updateDirectorySettings(client, workspaceId, patch);
    }

    const settings = await getDirectorySettings(client, workspaceId);
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse('Could not save settings.', 500, err);
  }
}
