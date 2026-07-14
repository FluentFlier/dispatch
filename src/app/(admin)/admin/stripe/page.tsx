import { assertAdmin } from '@/lib/admin';
import { getStripeHealthReport } from '@/lib/admin/stripe-health';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminStatCard } from '@/components/admin/AdminStatCard';
import { adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

function webhookStatusClass(status: string): string {
  if (status === 'ok') return 'bg-emerald-100 text-emerald-800';
  if (status === 'ignored') return 'bg-slate-100 text-slate-700';
  return 'bg-red-100 text-red-800';
}

/**
 * Stripe webhook health, recent events, and subscription mismatch alerts.
 */
export default async function AdminStripePage() {
  await assertAdmin();
  const report = await getStripeHealthReport();

  return (
    <div className={adminPage}>
      <AdminPageHeader
        title="Stripe health"
        description="Webhook delivery log and subscription consistency checks"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <AdminStatCard label="Webhook errors (24h)" value={String(report.recentErrors)} />
        <AdminStatCard label="Mismatches" value={String(report.mismatches.length)} />
        <AdminStatCard
          label="Stripe API"
          value={report.stripeApiChecked ? 'Configured' : 'Not configured'}
        />
      </div>

      {report.mismatches.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Subscription mismatches</h2>
          <div className={adminTableWrap}>
            <table className="w-full text-sm">
              <thead>
                <tr className={adminTableHead}>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Issue</th>
                  <th className="px-4 py-3 font-medium">DB plan / status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.mismatches.map((m) => (
                  <tr key={`${m.userId}-${m.issue}`} className={adminTableRow}>
                    <td className="px-4 py-3 font-mono text-xs">{m.userId.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-red-800 text-xs">{m.issue}</td>
                    <td className="px-4 py-3 text-text-secondary text-xs">
                      {m.dbPlan} / {m.dbStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold text-text-primary mb-3">Recent webhooks</h2>
        <div className={adminTableWrap}>
          <table className="w-full text-sm">
            <thead>
              <tr className={adminTableHead}>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Event ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.recentWebhooks.map((w) => (
                <tr key={w.id} className={adminTableRow}>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap text-xs">
                    {new Date(w.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{w.eventType}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${webhookStatusClass(w.status)}`}
                    >
                      {w.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-text-tertiary">
                    {w.eventId ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.recentWebhooks.length === 0 ? (
            <p className="p-8 text-center text-text-secondary">No webhook events logged yet</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
