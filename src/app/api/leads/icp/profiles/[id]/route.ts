import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { deleteIcpProfile, listIcpProfiles, updateIcpProfile } from '@/lib/signals/leads/icp-profiles';
import { errorResponse } from '@/lib/api-errors';
import { MAX_ICP_FIELD_LENGTH, MAX_ICP_KEYWORDS, MAX_ICP_VERTICALS } from '@/lib/signals/leads/icp-limits';

const term = z.string().trim().min(1).max(MAX_ICP_FIELD_LENGTH);

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).nullish(),
  verticals: z.array(term).max(MAX_ICP_VERTICALS).optional(),
  keywords: z.array(term).max(MAX_ICP_KEYWORDS).optional(),
  goal_type: z.enum(['networking', 'customer_acquisition', 'hiring', 'fundraising', 'other']).optional(),
  target_personas: z.array(z.string()).optional(),
  pitch_angle: z.string().max(2000).nullish(),
  tone_rules: z.string().max(2000).nullish(),
  daily_connect_limit: z.number().int().positive().max(100).optional(),
  daily_comment_limit: z.number().int().positive().max(100).optional(),
  sources: z.array(z.string()).optional(),
});

/**
 * PATCH /api/leads/icp/profiles/[id]
 * Update a saved ICP (rename, edit fields, agenda config). Returns the full list.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const client = getServerClient();
    await updateIcpProfile(client, workspaceId, params.id, parsed.data);
    const profiles = await listIcpProfiles(client, workspaceId);
    return NextResponse.json({ profiles });
  } catch (err) {
    return errorResponse('Could not update ICP.', 500, err);
  }
}

/**
 * DELETE /api/leads/icp/profiles/[id]
 * Remove a saved ICP; a remaining profile is promoted to active when needed.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    await deleteIcpProfile(client, workspaceId, params.id);
    const profiles = await listIcpProfiles(client, workspaceId);
    return NextResponse.json({ profiles });
  } catch (err) {
    return errorResponse('Could not delete ICP.', 500, err);
  }
}
