import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { errorResponse } from '@/lib/api-errors';
import {
  WORKSPACE_COOKIE,
  listWorkspaces,
  getActiveWorkspace,
  canCreateWorkspace,
  createClientWorkspace,
  ensureSoloWorkspace,
} from '@/lib/workspace';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
};

/** GET: list the caller's workspaces + the active one.
 * If none exist (ensureSoloWorkspace failed at login), provisions one now
 * via service-role client so RLS WITH CHECK on workspaces doesn't block the INSERT.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    let workspaces = await listWorkspaces(user.id);

    if (workspaces.length === 0) {
      // Lazy provision: getServerClient() produces an anonymous DB connection
      // that fails the RLS WITH CHECK on workspaces. Use ensureSoloWorkspace
      // which goes through the service-role client to bypass RLS for this step.
      try {
        const ws = await ensureSoloWorkspace(user.id);
        workspaces = [ws];
      } catch {
        // If provisioning fails here the user will get an empty list and the
        // onboarding page will surface a clear error instead of a silent 500.
      }
    }

    const active = workspaces.find((w) => w.type === 'solo') ?? workspaces[0] ?? null;
    return NextResponse.json({ workspaces, activeId: active?.id ?? null });
  } catch (err) {
    return errorResponse('Could not load workspaces.', 500, err);
  }
}

const CreateSchema = z.object({ name: z.string().trim().min(1).max(80) });

/** POST: create a new client workspace (plan-gated). */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  try {
    const gate = await canCreateWorkspace(user.id);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 402 });

    const workspace = await createClientWorkspace(user.id, parsed.data.name);
    const res = NextResponse.json({ workspace });
    res.cookies.set(WORKSPACE_COOKIE, workspace.id, COOKIE_OPTS);
    return res;
  } catch (err) {
    return errorResponse('Could not create workspace.', 500, err);
  }
}

const SwitchSchema = z.object({ workspaceId: z.string().uuid() });

/** PUT: switch the active workspace (validates membership, sets the cookie). */
export async function PUT(req: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = SwitchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  try {
    const workspaces = await listWorkspaces(user.id);
    const target = workspaces.find((w) => w.id === parsed.data.workspaceId);
    if (!target) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const res = NextResponse.json({ activeId: target.id });
    res.cookies.set(WORKSPACE_COOKIE, target.id, COOKIE_OPTS);
    return res;
  } catch (err) {
    return errorResponse('Could not switch workspace.', 500, err);
  }
}
