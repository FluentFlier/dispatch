import { cookies } from 'next/headers';
import { getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getUserEntitlements } from '@/lib/entitlements';
import { logWarn } from '@/lib/logger';

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
  const { data: members, error: membersError } = await client.database
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId);

  if (membersError) {
    logWarn('workspace.list_members_failed', { userId, dbError: membersError.message ?? membersError, hint: membersError.hint });
  }

  const memberList = (members ?? []) as { workspace_id: string; role: string }[];
  if (memberList.length === 0) return [];

  const ids = new Set(memberList.map((m) => m.workspace_id));
  const roleById = new Map(memberList.map((m) => [m.workspace_id, m.role]));

  // Filter by id IN the user's workspace set at the DB level - the previous
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

/**
 * Active workspace id, provisioning a solo workspace if none exists yet.
 *
 * Use this on any path that WRITES workspace-scoped rows (social-account sync,
 * connect, webhooks). A brand-new user can reach these paths before the
 * fire-and-forget login provisioning finishes, in which case getActiveWorkspaceId
 * returns null and rows get written with workspace_id = null, then hidden forever
 * once provisioning lands. Ensuring here closes that race deterministically.
 */
export async function ensureActiveWorkspaceId(userId: string): Promise<string> {
  const existing = await getActiveWorkspaceId(userId);
  if (existing) return existing;
  return (await ensureSoloWorkspace(userId)).id;
}

/**
 * Repair social_accounts rows written with workspace_id = null during the
 * first-login race, assigning them to the user's now-known workspace. Self-heals
 * accounts that would otherwise stay hidden behind the workspace-scoped filter.
 */
export async function backfillNullWorkspaceSocialAccounts(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const admin = getServiceClient();
  const { error } = await admin.database
    .from('social_accounts')
    .update({ workspace_id: workspaceId })
    .eq('user_id', userId)
    .is('workspace_id', null);
  if (error) {
    logWarn('workspace.backfill_null_social_accounts_failed', {
      userId,
      dbError: error.message ?? error,
    });
  }
}

/** Ensure a brand-new user has a solo workspace (post-migration signups). */
export async function ensureSoloWorkspace(userId: string): Promise<Workspace> {
  // Must use service client for BOTH the read and the insert.
  // This runs before the session cookie is written, so getServerClient() returns
  // an anon connection - RLS blocks the membership read and returns 0 rows,
  // causing duplicate workspaces on every login attempt.
  const adminClient = getServiceClient();

  // Check via workspace_members using service client (bypasses RLS).
  const { data: existing } = await adminClient.database
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId);

  const memberList = (existing ?? []) as { workspace_id: string; role: string }[];
  if (memberList.length > 0) {
    const ids = memberList.map((m) => m.workspace_id);
    const roleById = new Map(memberList.map((m) => [m.workspace_id, m.role]));
    const { data: ws } = await adminClient.database
      .from('workspaces')
      .select('id, name, type, owner_user_id')
      .in('id', ids);
    const workspaces = ((ws ?? []) as Omit<Workspace, 'role'>[]).map((w) => ({ ...w, role: roleById.get(w.id) }));
    if (workspaces.length) return workspaces.find((w) => w.type === 'solo') ?? workspaces[0];
  }
  const { data, error } = await adminClient.database
    .from('workspaces')
    .insert([{ owner_user_id: userId, name: 'My workspace', type: 'solo' }])
    .select('id, name, type, owner_user_id')
    .single();

  if (error) {
    // Unique violation: another concurrent call already created the workspace (race condition).
    // Fetch and return the existing one instead of throwing.
    const isUnique = error.code === '23505'
      || error.message?.toLowerCase().includes('duplicate')
      || error.message?.toLowerCase().includes('unique')
      || error.message?.toLowerCase().includes('already exists');

    if (isUnique) {
      const { data: existingWs } = await adminClient.database
        .from('workspaces')
        .select('id, name, type, owner_user_id')
        .eq('owner_user_id', userId)
        .eq('type', 'solo')
        .limit(1)
        .single();
      if (existingWs) {
        const existing = existingWs as Workspace;
        // Ensure membership row exists for this workspace.
        await adminClient.database
          .from('workspace_members')
          .upsert([{ workspace_id: existing.id, user_id: userId, role: 'owner' }], { onConflict: 'workspace_id,user_id' });
        return { ...existing, role: 'owner' };
      }
    }

    logWarn('workspace.provision_insert_failed', { userId, dbError: error?.message ?? error, hint: error?.hint });
    throw new Error('Could not create workspace');
  }

  if (!data) {
    logWarn('workspace.provision_insert_failed', { userId, dbError: 'no data returned' });
    throw new Error('Could not create workspace');
  }

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
