import { assertAdmin } from '@/lib/admin';
import { getAdminAuditLog } from '@/lib/admin/audit';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

/**
 * Admin audit log - who changed plans, flags, publish jobs, and impersonation sessions.
 */
export default async function AdminAuditPage() {
  await assertAdmin();
  const entries = await getAdminAuditLog(200);

  return (
    <div className={adminPage}>
      <AdminPageHeader
        title="Audit log"
        description="Immutable record of admin actions"
      />

      <div className={adminTableWrap}>
        <table className="w-full text-sm">
          <thead>
            <tr className={adminTableHead}>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((e) => (
              <tr key={e.id} className={adminTableRow}>
                <td className="px-4 py-3 text-text-secondary whitespace-nowrap text-xs">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-text-primary text-xs">{e.actorEmail}</td>
                <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
                <td className="px-4 py-3 text-xs text-text-secondary">
                  {e.targetType ? `${e.targetType}:${e.targetId ?? '-'}` : '-'}
                </td>
                <td className="px-4 py-3 font-mono text-[10px] text-text-tertiary max-w-xs truncate">
                  {Object.keys(e.details).length ? JSON.stringify(e.details) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 ? (
          <p className="p-8 text-center text-text-secondary">No audit entries yet</p>
        ) : null}
      </div>
    </div>
  );
}
