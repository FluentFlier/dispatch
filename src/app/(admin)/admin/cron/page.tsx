import { assertAdmin } from '@/lib/admin';
import { getAdminCronRuns } from '@/lib/admin/cron-log';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

function statusClass(status: string): string {
  if (status === 'ok') return 'bg-emerald-100 text-emerald-800';
  if (status === 'partial') return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

/**
 * Cron run history for fast and medium fan-out jobs.
 */
export default async function AdminCronPage() {
  await assertAdmin();
  const runs = await getAdminCronRuns(150);

  return (
    <div className={adminPage}>
      <AdminPageHeader
        title="Cron history"
        description="Recent fan-out cron executions (fast every 5m, medium every 15m)"
      />

      <div className={adminTableWrap}>
        <table className="w-full text-sm">
          <thead>
            <tr className={adminTableHead}>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Job</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map((r) => (
              <tr key={r.id} className={adminTableRow}>
                <td className="px-4 py-3 text-text-secondary whitespace-nowrap text-xs">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-medium">{r.jobName}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusClass(r.status)}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-text-secondary">
                  {r.durationMs != null ? `${r.durationMs}ms` : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-red-700 max-w-md truncate">
                  {r.errorMessage ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 ? (
          <p className="p-8 text-center text-text-secondary">
            No cron runs logged yet — tables apply after migration
          </p>
        ) : null}
      </div>
    </div>
  );
}
