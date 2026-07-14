import { getServiceClient } from '@/lib/insforge/server';

export type AdminAuditAction =
  | 'user.subscription_update'
  | 'user.onboarding_update'
  | 'flag.toggle'
  | 'publish.retry'
  | 'impersonate.start'
  | 'impersonate.end'
  | 'trial_code.create'
  | 'trial_code.update'
  | 'trial_code.delete';

export interface AdminAuditEntry {
  id: string;
  actorEmail: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/**
 * Persists an admin action to admin_audit_log for compliance and support forensics.
 * Failures are logged but never block the mutating operation.
 */
export async function logAdminAction(input: {
  actorEmail: string;
  actorUserId?: string;
  action: AdminAuditAction;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const client = getServiceClient();
    const { error } = await client.database.from('admin_audit_log').insert([
      {
        actor_email: input.actorEmail,
        actor_user_id: input.actorUserId ?? null,
        action: input.action,
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        details: input.details ?? {},
      },
    ]);
    if (error) {
      console.warn('[admin-audit] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[admin-audit] unexpected error:', err);
  }
}

/**
 * Returns recent audit log rows for the admin audit page.
 */
export async function getAdminAuditLog(limit = 100): Promise<AdminAuditEntry[]> {
  const client = getServiceClient();
  const { data, error } = await client.database
    .from('admin_audit_log')
    .select('id, actor_email, actor_user_id, action, target_type, target_id, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    actorEmail: row.actor_email as string,
    actorUserId: (row.actor_user_id as string | null) ?? null,
    action: row.action as string,
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    details: (row.details as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  }));
}
