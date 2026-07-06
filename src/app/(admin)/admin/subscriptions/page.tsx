import { assertAdmin } from '@/lib/admin';
import { getAdminSubscriptions } from '@/lib/admin-data';
import { SubscriptionEditor } from '@/components/admin/SubscriptionEditor';

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

/**
 * Billing overview with manual plan/status overrides per user.
 */
export default async function AdminSubscriptionsPage() {
  await assertAdmin();
  const subs = await getAdminSubscriptions();

  const byPlan: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const s of subs) {
    byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Billing</h1>
        <p className="text-sm text-[#6b7280] mt-1">Subscription state across all users</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(byPlan).map(([plan, count]) => (
          <div key={plan} className="rounded-lg border border-[#2a2d35] bg-[#1a1d24] p-3">
            <p className="text-[11px] uppercase text-[#6b7280]">{plan}</p>
            <p className="text-xl font-semibold text-white tabular-nums">{count}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2a2d35]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2d35] bg-[#13151b] text-left text-[#6b7280] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">User ID</th>
              <th className="px-4 py-3 font-medium">Override</th>
              <th className="px-4 py-3 font-medium">Stripe</th>
              <th className="px-4 py-3 font-medium">Period end</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2d35]">
            {subs.map((s) => (
              <tr key={s.userId} className="bg-[#1a1d24]">
                <td className="px-4 py-3 font-mono text-[11px] text-[#9ca3af]" title={s.userId}>
                  {shortId(s.userId)}
                </td>
                <td className="px-4 py-3">
                  <SubscriptionEditor userId={s.userId} plan={s.plan} status={s.status} />
                </td>
                <td className="px-4 py-3 text-[#6b7280] text-xs">
                  {s.stripeCustomerId ? shortId(s.stripeCustomerId) : '—'}
                </td>
                <td className="px-4 py-3 text-[#9ca3af] text-xs whitespace-nowrap">
                  {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-[#9ca3af] text-xs whitespace-nowrap">
                  {new Date(s.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-[#2a2d35] bg-[#1a1d24] p-4">
        <h2 className="text-sm font-semibold text-white mb-2">Status breakdown</h2>
        <div className="flex flex-wrap gap-3">
          {Object.entries(byStatus).map(([status, count]) => (
            <span key={status} className="text-sm text-[#9ca3af]">
              <span className="font-mono text-white">{status}</span>: {count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
