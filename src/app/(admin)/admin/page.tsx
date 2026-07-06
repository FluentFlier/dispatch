import Link from 'next/link';
import { assertAdmin } from '@/lib/admin';
import { getAdminOverview } from '@/lib/admin-data';
import { AdminStatCard } from '@/components/admin/AdminStatCard';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminCard, adminCardInset, adminLink, adminPage } from '@/components/admin/admin-ui';
import { PRODUCT_NAME } from '@/lib/brand';

/**
 * Admin overview: platform KPIs and quick links to ops surfaces.
 */
export default async function AdminOverviewPage() {
  await assertAdmin();
  const data = await getAdminOverview();

  const failedTotal = data.publishQueue.failed + data.publishQueue.dead;
  const onboardPct =
    data.users > 0 ? Math.round((data.onboarded / data.users) * 100) : 0;

  return (
    <div className={`${adminPage} space-y-8`}>
      <AdminPageHeader
        title="Overview"
        description={`${PRODUCT_NAME} platform health · updated ${new Date(data.timestamp).toLocaleString()}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AdminStatCard label="Total users" value={data.users} sub={`${onboardPct}% onboarded`} />
        <AdminStatCard
          label="Active trials"
          value={data.activeTrials}
          sub={
            data.trialsExpiringSoon > 0
              ? `${data.trialsExpiringSoon} expiring in 7 days`
              : '7-day trial funnel'
          }
          variant={data.trialsExpiringSoon > 0 ? 'warning' : 'default'}
        />
        <AdminStatCard label="Posts today" value={data.postsToday} />
        <AdminStatCard
          label="Failed publishes"
          value={failedTotal}
          variant={failedTotal > 0 ? 'danger' : 'success'}
          sub={`${data.publishQueue.queued} queued · ${data.publishQueue.processing} processing`}
        />
        <AdminStatCard
          label="AI gens (month)"
          value={data.aiUsageToday}
          sub="current billing period"
        />
        {data.leadsCount != null ? (
          <AdminStatCard label="Leads pipeline" value={data.leadsCount} sub="signal_leads rows" />
        ) : null}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className={adminCard}>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Subscriptions</h2>
          {Object.keys(data.subscriptions).length === 0 ? (
            <p className="text-sm text-text-secondary">No subscriptions yet</p>
          ) : (
            <ul className="space-y-1.5">
              {Object.entries(data.subscriptions)
                .sort((a, b) => b[1] - a[1])
                .map(([key, count]) => (
                  <li key={key} className="flex justify-between text-sm">
                    <span className="font-mono text-text-secondary">{key}</span>
                    <span className="text-text-primary tabular-nums font-medium">{count}</span>
                  </li>
                ))}
            </ul>
          )}
          <Link href="/admin/subscriptions" className={`${adminLink} mt-3 inline-block`}>
            Manage billing →
          </Link>
        </section>

        <section className={adminCard}>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Quick actions</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { href: '/admin/publish', label: 'Publish queue', desc: 'Retry failed jobs' },
              {
                href: '/admin/flags',
                label: 'Feature flags',
                desc: data.signalsEnabled ? 'Signals ON' : 'Signals OFF',
              },
              { href: '/admin/users', label: 'Users', desc: `${data.users} accounts` },
              { href: '/admin/system', label: 'System health', desc: 'Env & deps' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${adminCardInset} hover:border-accent-primary/30 transition-colors`}
              >
                <p className="text-sm font-medium text-text-primary">{item.label}</p>
                <p className="text-xs text-text-secondary mt-0.5">{item.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
