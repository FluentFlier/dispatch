import { assertAdmin } from '@/lib/admin';
import { getAdminUsage } from '@/lib/admin-data';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminCard, adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

const METRIC_LABELS: Record<string, string> = {
  ai_generate: 'AI generations',
  publish_post: 'Publishes',
  scheduled_post: 'Scheduled',
  connected_account: 'Connected accounts',
};

/**
 * Cross-tenant usage counters for the current billing period.
 */
export default async function AdminUsagePage() {
  await assertAdmin();
  const rows = await getAdminUsage(300);

  const byMetric: Record<string, number> = {};
  for (const r of rows) {
    byMetric[r.metric] = (byMetric[r.metric] ?? 0) + r.count;
  }

  return (
    <div className={adminPage}>
      <AdminPageHeader
        title="Usage"
        description={`Current month totals · period ${rows[0]?.periodKey ?? new Date().toISOString().slice(0, 7)}`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(byMetric).map(([metric, total]) => (
          <div key={metric} className={`${adminCard} py-3`}>
            <p className="text-[11px] text-text-tertiary">
              {METRIC_LABELS[metric] ?? metric}
            </p>
            <p className="text-xl font-semibold text-text-primary tabular-nums">{total}</p>
          </div>
        ))}
      </div>

      <div className={adminTableWrap}>
        <table className="w-full text-sm">
          <thead>
            <tr className={adminTableHead}>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Metric</th>
              <th className="px-4 py-3 font-medium">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={`${r.userId}-${r.metric}-${i}`} className={adminTableRow}>
                <td className="px-4 py-3 font-mono text-[11px] text-text-tertiary" title={r.userId}>
                  {shortId(r.userId)}
                </td>
                <td className="px-4 py-3 text-text-primary">
                  {METRIC_LABELS[r.metric] ?? r.metric}
                </td>
                <td className="px-4 py-3 text-text-primary tabular-nums font-medium">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-text-secondary">No usage recorded this period</p>
        ) : null}
      </div>
    </div>
  );
}
