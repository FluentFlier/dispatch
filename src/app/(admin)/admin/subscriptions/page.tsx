import { assertAdmin } from '@/lib/admin';
import { getAdminSubscriptions } from '@/lib/admin-data';
import { SubscriptionEditor } from '@/components/admin/SubscriptionEditor';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminCard, adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

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
  let activeTrials = 0;
  for (const s of subs) {
    byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.status === 'trialing') activeTrials++;
  }

  return (
    <div className={adminPage}>
      <AdminPageHeader
        title="Billing"
        description="Subscription state across all users"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(byPlan).map(([plan, count]) => (
          <div key={plan} className={`${adminCard} py-3`}>
            <p className="text-[11px] text-text-tertiary">{plan}</p>
            <p className="text-xl font-semibold text-text-primary tabular-nums">{count}</p>
          </div>
        ))}
        <div className={`${adminCard} py-3 border-amber-200 bg-amber-50`}>
          <p className="text-[11px] text-amber-800/70">trialing</p>
          <p className="text-xl font-semibold text-amber-900 tabular-nums">{activeTrials}</p>
        </div>
      </div>

      <div className={adminTableWrap}>
        <table className="w-full text-sm">
          <thead>
            <tr className={adminTableHead}>
              <th className="px-4 py-3 font-medium">User ID</th>
              <th className="px-4 py-3 font-medium">Override</th>
              <th className="px-4 py-3 font-medium">Stripe</th>
              <th className="px-4 py-3 font-medium">Trial ends</th>
              <th className="px-4 py-3 font-medium">Period end</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {subs.map((s) => (
              <tr key={s.userId} className={adminTableRow}>
                <td className="px-4 py-3 font-mono text-[11px] text-text-secondary" title={s.userId}>
                  {shortId(s.userId)}
                </td>
                <td className="px-4 py-3">
                  <SubscriptionEditor userId={s.userId} plan={s.plan} status={s.status} />
                </td>
                <td className="px-4 py-3 text-text-tertiary text-xs">
                  {s.stripeCustomerId ? shortId(s.stripeCustomerId) : '-'}
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                  {s.trialEndsAt ? new Date(s.trialEndsAt).toLocaleDateString() : '-'}
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                  {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '-'}
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                  {new Date(s.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={adminCard}>
        <h2 className="text-sm font-semibold text-text-primary mb-2">Status breakdown</h2>
        <div className="flex flex-wrap gap-3">
          {Object.entries(byStatus).map(([status, count]) => (
            <span key={status} className="text-sm text-text-secondary">
              <span className="text-text-primary">{status}</span>: {count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
