import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getSafetyStatus, updateSafetySettings } from '@/lib/signals/safety';
import { errorResponse } from '@/lib/api-errors';

const PatchSchema = z.object({
  outreach_enabled: z.boolean().optional(),
  auto_send_enabled: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  max_linkedin_invites_per_day: z.number().int().min(1).max(50).optional(),
  max_linkedin_inmail_per_day: z.number().int().min(1).max(50).optional(),
  max_x_dm_per_day: z.number().int().min(1).max(50).optional(),
  max_linkedin_invites_per_week: z.number().int().min(1).max(150).optional(),
  min_seconds_between_sends: z.number().int().min(60).max(3600).optional(),
  working_hours_only: z.boolean().optional(),
}).strict();

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const status = await getSafetyStatus(client, workspaceId);
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse('Could not load safety status.', 500, err);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (body.auto_send_enabled === true && body.outreach_enabled === false) {
    return NextResponse.json(
      { error: 'Enable outreach before enabling auto-send.' },
      { status: 400 },
    );
  }

  if (body.auto_send_enabled === true) {
    return NextResponse.json(
      {
        error:
          'Auto-send is not available yet. Manual approve-only keeps accounts safe. Use draft + copy for now.',
      },
      { status: 400 },
    );
  }

  try {
    const client = getServerClient();
    await updateSafetySettings(client, workspaceId, body);
    const status = await getSafetyStatus(client, workspaceId);
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse('Could not update safety settings.', 500, err);
  }
}
