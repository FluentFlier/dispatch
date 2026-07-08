import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { createIcpProfile, ensureSeedProfile, listIcpProfiles } from '@/lib/signals/leads/icp-profiles';
import { errorResponse } from '@/lib/api-errors';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).nullish(),
  verticals: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  goal_type: z.enum(['networking', 'customer_acquisition', 'hiring', 'fundraising', 'other']).optional(),
  target_personas: z.array(z.string()).optional(),
  pitch_angle: z.string().max(2000).nullish(),
  tone_rules: z.string().max(2000).nullish(),
  activate: z.boolean().optional(),
});

/**
 * GET /api/leads/icp/profiles
 * The workspace's saved ICP profiles (agendas), seeding a "Default" from the
 * current directory settings on first access so nothing is lost.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const profiles = await ensureSeedProfile(client, workspaceId);
    return NextResponse.json({ profiles });
  } catch (err) {
    return errorResponse('Could not load ICP profiles.', 500, err);
  }
}

/**
 * POST /api/leads/icp/profiles
 * Save the current working ICP as a named profile. Returns the full list so the
 * client can refresh in one round-trip.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const client = getServerClient();
    await createIcpProfile(client, workspaceId, parsed.data);
    const profiles = await listIcpProfiles(client, workspaceId);
    return NextResponse.json({ profiles });
  } catch (err) {
    return errorResponse('Could not save ICP.', 500, err);
  }
}
