import Link from 'next/link';
import { assertAdmin } from '@/lib/admin';
import { getAdminOverview } from '@/lib/admin-data';
import { AdminStatCard } from '@/components/admin/AdminStatCard';

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
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Overview</h1>
        <p className="text-sm text-[#6b7280] mt-1">
          Platform health at a glance · updated {new Date(data.timestamp).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AdminStatCard label="Total users" value={data.users} sub={`${onboardPct}% onboarded`} />
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
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="rounded-lg border border-[#2a2d35] bg-[#1a1d24] p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Subscriptions</h2>
          {Object.keys(data.subscriptions).length === 0 ? (
            <p className="text-sm text-[#6b7280]">No subscriptions yet</p>
          ) : (
            <ul className="space-y-1.5">
              {Object.entries(data.subscriptions)
                .sort((a, b) => b[1] - a[1])
                .map(([key, count]) => (
                  <li key={key} className="flex justify-between text-sm">
                    <span className="font-mono text-[#9ca3af]">{key}</span>
                    <span className="text-white tabular-nums">{count}</span>
                  </li>
                ))}
            </ul>
          )}
          <Link href="/admin/subscriptions" className="text-xs text-[#93c5fd] mt-3 inline-block hover:underline">
            Manage billing →
          </Link>
        </section>

        <section className="rounded-lg border border-[#2a2d35] bg-[#1a1d24] p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Quick actions</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { href: '/admin/publish', label: 'Publish queue', desc: 'Retry failed jobs' },
              { href: '/admin/flags', label: 'Feature flags', desc: data.signalsEnabled ? 'Signals ON' : 'Signals OFF' },
              { href: '/admin/users', label: 'Users', desc: `${data.users} accounts` },
              { href: '/admin/system', label: 'System health', desc: 'Env & deps' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md border border-[#2a2d35] bg-[#13151b] p-3 hover:border-[#2563eb]/50 transition-colors"
              >
                <p className="text-sm font-medium text-white">{item.label}</p>
                <p className="text-xs text-[#6b7280] mt-0.5">{item.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
