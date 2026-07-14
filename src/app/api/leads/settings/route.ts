import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getDirectorySettings, updateDirectorySettings } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

/**
 * Whitelist of settings the client may write. Zod strips any other key, so an
 * arbitrary field can never reach the underlying `.update()`. `timezone` is
 * handled separately (mirrored onto the workspace row, not the settings row).
 */
const putSchema = z
  .object({
    timezone: z.string().max(64),
    enabled_sources: z.array(
      z.enum(['yc_directory', 'yc_launches', 'product_hunt', 'manual']),
    ),
    icp_description: z.string().max(4000).nullable(),
    icp_verticals: z.array(z.string()),
    icp_keywords: z.array(z.string()),
    recency_window: z.string().max(32),
    digest_run_hour_local: z.number().int().min(0).max(23),
    digest_timezone: z.string().max(64).nullable(),
    digest_channels: z.object({ today: z.boolean(), slack: z.boolean(), email: z.boolean() }),
    digest_top_n: z.number().int().min(0).max(100),
    sender_identity: z.string().max(200).nullable(),
    digest_delivered_at: z.string().nullable(),
  })
  .partial();

/** GET /api/leads/settings — directory + digest config. */
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

  const parsed = putSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const body = parsed.data;

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

    const { timezone: _tz, ...patch } = body;
    if (Object.keys(patch).length > 0) {
      await updateDirectorySettings(client, workspaceId, patch);
    }

    const settings = await getDirectorySettings(client, workspaceId);
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse('Could not save settings.', 500, err);
  }
}
