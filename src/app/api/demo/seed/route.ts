import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId, ensureSoloWorkspace } from '@/lib/workspace';
import { seedDemoWorkspace } from '@/lib/demo/seed-workspace';
import { errorResponse } from '@/lib/api-errors';

const BodySchema = z
  .object({
    user_id: z.string().uuid().optional(),
    workspace_id: z.string().uuid().optional(),
  })
  .strict();

function demoSeedAllowed(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  if (process.env.DEMO_SEED_ENABLED === 'true') return true;
  if (process.env.SIGNALS_ALLOW_SEED === 'true') return true;

  const secret = process.env.DEMO_SEED_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

/**
 * POST /api/demo/seed
 * Seeds demo profile + GTM signals for the current user, or ops mode with Bearer secret + user_id.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!demoSeedAllowed(request)) {
    return NextResponse.json({ error: 'Demo seed disabled' }, { status: 403 });
  }

  let body: z.infer<typeof BodySchema> = {};
  try {
    const raw = await request.json().catch(() => ({}));
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const bearer = request.headers.get('authorization')?.startsWith('Bearer ');
  const opsMode = bearer && body.user_id;

  try {
    if (opsMode) {
      const client = getServiceClient();
      let workspaceId = body.workspace_id ?? null;

      if (!workspaceId) {
        const { data: member } = await client.database
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', body.user_id!)
          .limit(1)
          .maybeSingle();
        workspaceId = (member?.workspace_id as string) ?? null;
      }

      if (!workspaceId) {
        const ws = await ensureSoloWorkspace(body.user_id!);
        workspaceId = ws.id;
      }

      const result = await seedDemoWorkspace(client, body.user_id!, workspaceId);
      return NextResponse.json({ ok: true, ...result });
    }

    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const workspaceId = await getActiveWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
    }

    const client = getServerClient();
    const result = await seedDemoWorkspace(client, user.id, workspaceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse('Demo seed failed.', 500, err);
  }
}
