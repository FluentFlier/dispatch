import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { createClient } from '@insforge/sdk';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId, ensureSoloWorkspace } from '@/lib/workspace';
import { seedDemoWorkspace } from '@/lib/demo/seed-workspace';
import { errorResponse } from '@/lib/api-errors';
import { logInfo, logWarn } from '@/lib/logger';

const BodySchema = z
  .object({
    user_id: z.string().uuid().optional(),
    workspace_id: z.string().uuid().optional(),
  })
  .strict();

/**
 * Whether the request carries the valid ops Bearer secret. Ops mode targets an
 * arbitrary user via the service client (RLS bypass), so this MUST hold in every
 * environment — there is no NODE_ENV shortcut.
 */
function opsSecretValid(request: NextRequest): boolean {
  const secret = process.env.DEMO_SEED_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * Whether an authenticated user may seed THEIR OWN workspace. Allowed freely in
 * dev for convenience; in production it requires an explicit opt-in flag.
 */
function selfSeedAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.DEMO_SEED_ENABLED === 'true' || process.env.SIGNALS_ALLOW_SEED === 'true';
}

/** Defense-in-depth: confirm the target user actually belongs to the workspace. */
async function userOwnsWorkspace(
  client: ReturnType<typeof createClient>,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await client.database
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.workspace_id);
}

/**
 * POST /api/demo/seed
 * Seeds demo profile + GTM signals for the current user, or ops mode with a valid
 * Bearer secret + user_id. Every seed is audit-logged.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof BodySchema> = {};
  try {
    const raw = await request.json().catch(() => ({}));
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const hasBearer = request.headers.get('authorization')?.startsWith('Bearer ') ?? false;
  const opsMode = hasBearer && Boolean(body.user_id);

  try {
    if (opsMode) {
      // Ops mode uses the service client (bypasses RLS) — always require the secret.
      if (!opsSecretValid(request)) {
        logWarn('demo.seed.ops_denied', { userId: body.user_id });
        return NextResponse.json({ error: 'Invalid ops credentials' }, { status: 403 });
      }

      const client = getServiceClient();
      let workspaceId = body.workspace_id ?? null;

      if (workspaceId) {
        // Never seed a caller-supplied workspace the target user does not own.
        if (!(await userOwnsWorkspace(client, body.user_id!, workspaceId))) {
          logWarn('demo.seed.ops_workspace_mismatch', { userId: body.user_id, workspaceId });
          return NextResponse.json({ error: 'Workspace does not belong to user' }, { status: 403 });
        }
      } else {
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
      logInfo('demo.seed', { mode: 'ops', userId: body.user_id, workspaceId });
      return NextResponse.json({ ok: true, ...result });
    }

    // Self-seed: an authenticated user seeding only their own active workspace.
    if (!selfSeedAllowed()) {
      return NextResponse.json({ error: 'Demo seed disabled' }, { status: 403 });
    }

    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const workspaceId = await getActiveWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
    }

    const client = getServerClient();
    const result = await seedDemoWorkspace(client, user.id, workspaceId);
    logInfo('demo.seed', { mode: 'self', userId: user.id, workspaceId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse('Demo seed failed.', 500, err);
  }
}
