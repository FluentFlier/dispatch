import { cookies } from 'next/headers';
import { getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getUserEntitlements } from '@/lib/entitlements';

export const WORKSPACE_COOKIE = 'content-os-workspace';

export type WorkspaceType = 'solo' | 'client';

export interface Workspace {
  id: string;
  name: string;
  type: WorkspaceType;
  owner_user_id: string;
  role?: string;
}

// Max workspaces per plan. Solo creators stay at 1; agencies scale with tier.
const WORKSPACE_LIMIT: Record<string, number> = {
  free: 1,
  starter: 3,
  growth: 10,
  pro: 50,
};

/** All workspaces the user belongs to (RLS already restricts to their own). */
export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  const client = getServerClient();
  const { data: members } = await client.database
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId);

  const memberList = (members ?? []) as { workspace_id: string; role: string }[];
  if (memberList.length === 0) return [];

  const ids = new Set(memberList.map((m) => m.workspace_id));
  const roleById = new Map(memberList.map((m) => [m.workspace_id, m.role]));

  // Filter by id IN the user's workspace set at the DB level — the previous
  // version fetched ALL workspaces from all users and filtered in JS, which
  // was both a performance issue and a data privacy concern as the platform grows.
  const { data: ws } = await client.database
    .from('workspaces')
    .select('id, name, type, owner_user_id')
    .in('id', Array.from(ids))
    .order('created_at', { ascending: true });

  return ((ws ?? []) as Omit<Workspace, 'role'>[])
    .map((w) => ({ ...w, role: roleById.get(w.id) }));
}

/** Resolve the active workspace from the cookie, falling back to solo/first. */
export async function getActiveWorkspace(userId: string): Promise<Workspace | null> {
  const list = await listWorkspaces(userId);
  if (list.length === 0) return null;
  const cookieId = cookies().get(WORKSPACE_COOKIE)?.value;
  return (
    list.find((w) => w.id === cookieId) ??
    list.find((w) => w.type === 'solo') ??
    list[0]
  );
}

export async function getActiveWorkspaceId(userId: string): Promise<string | null> {
  return (await getActiveWorkspace(userId))?.id ?? null;
}

/** Ensure a brand-new user has a solo workspace (post-migration signups). */
export async function ensureSoloWorkspace(userId: string): Promise<Workspace> {
  const list = await listWorkspaces(userId);
  if (list.length) return list.find((w) => w.type === 'solo') ?? list[0];

  // Use the service-role client for these two inserts. ensureSoloWorkspace is
  // called during the login flow before the session cookie has been written, so
  // getServerClient() would produce an anonymous DB connection that fails the
  // RLS WITH CHECK on the workspaces table. The service key bypasses RLS only
  // for this provisioning step; all reads still use the user-scoped client.
  const adminClient = getServiceClient();
  const { data, error } = await adminClient.database
    .from('workspaces')
    .insert([{ owner_user_id: userId, name: 'My workspace', type: 'solo' }])
    .select('id, name, type, owner_user_id')
    .single();
  if (error || !data) throw new Error('Could not create workspace');

  const w = data as Workspace;
  await adminClient.database
    .from('workspace_members')
    .insert([{ workspace_id: w.id, user_id: userId, role: 'owner' }]);
  return { ...w, role: 'owner' };
}

/** Whether the user can create another (client) workspace under their plan. */
export async function canCreateWorkspace(
  userId: string,
): Promise<{ ok: boolean; error?: string; limit: number; used: number }> {
  const [list, ent] = await Promise.all([
    listWorkspaces(userId),
    getUserEntitlements(userId),
  ]);
  const limit = WORKSPACE_LIMIT[ent.plan] ?? 1;
  const used = list.length;
  if (used >= limit) {
    return {
      ok: false,
      limit,
      used,
      error:
        limit <= 1
          ? 'Managing multiple client workspaces requires a paid plan.'
          : `Workspace limit reached (${limit}). Upgrade for more clients.`,
    };
  }
  return { ok: true, limit, used };
}

export async function createClientWorkspace(
  userId: string,
  name: string,
): Promise<Workspace> {
  const client = getServerClient();
  const { data, error } = await client.database
    .from('workspaces')
    .insert([{ owner_user_id: userId, name, type: 'client' }])
    .select('id, name, type, owner_user_id')
    .single();
  if (error || !data) throw new Error('Could not create workspace');

  const w = data as Workspace;
  await client.database
    .from('workspace_members')
    .insert([{ workspace_id: w.id, user_id: userId, role: 'owner' }]);
  return { ...w, role: 'owner' };
}
