import { assertAdmin } from '@/lib/admin';
import { getAdminUsage } from '@/lib/admin-data';

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
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Usage</h1>
        <p className="text-sm text-[#6b7280] mt-1">
          Current month totals · period {rows[0]?.periodKey ?? new Date().toISOString().slice(0, 7)}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(byMetric).map(([metric, total]) => (
          <div key={metric} className="rounded-lg border border-[#2a2d35] bg-[#1a1d24] p-3">
            <p className="text-[11px] uppercase text-[#6b7280]">
              {METRIC_LABELS[metric] ?? metric}
            </p>
            <p className="text-xl font-semibold text-white tabular-nums">{total}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2a2d35]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2d35] bg-[#13151b] text-left text-[#6b7280] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Metric</th>
              <th className="px-4 py-3 font-medium">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2d35]">
            {rows.map((r, i) => (
              <tr key={`${r.userId}-${r.metric}-${i}`} className="bg-[#1a1d24]">
                <td className="px-4 py-3 font-mono text-[11px] text-[#6b7280]" title={r.userId}>
                  {shortId(r.userId)}
                </td>
                <td className="px-4 py-3 text-white">
                  {METRIC_LABELS[r.metric] ?? r.metric}
                </td>
                <td className="px-4 py-3 text-white tabular-nums font-medium">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-[#6b7280]">No usage recorded this period</p>
        ) : null}
      </div>
    </div>
  );
}
