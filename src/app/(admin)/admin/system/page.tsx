import { assertAdmin } from '@/lib/admin';
import { getAdminSystemHealth } from '@/lib/admin-data';

const CHECK_LABELS: Record<string, string> = {
  insforge: 'InsForge API',
  serviceRole: 'Service role key',
  encryption: 'Token encryption',
  cron: 'Cron secret',
  stripe: 'Stripe',
  llm: 'LLM provider',
  social: 'Social provider',
};

/**
 * Environment and dependency health for ops.
 */
export default async function AdminSystemPage() {
  await assertAdmin();
  const health = await getAdminSystemHealth();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">System</h1>
        <p className="text-sm text-[#6b7280] mt-1">
          Dependency checks · {new Date(health.timestamp).toLocaleString()}
        </p>
      </div>

      <div
        className={`rounded-lg border p-4 ${
          health.status === 'ok'
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-amber-500/30 bg-amber-500/10'
        }`}
      >
        <p className="text-lg font-semibold text-white capitalize">{health.status}</p>
        <p className="text-sm text-[#9ca3af] mt-1">
          Social provider: <span className="font-mono text-white">{health.provider}</span>
        </p>
        <p className="text-sm text-[#9ca3af]">
          Admin allowlist:{' '}
          <span className={health.adminEmailsConfigured ? 'text-emerald-400' : 'text-red-400'}>
            {health.adminEmailsConfigured ? 'configured' : 'ADMIN_EMAILS not set'}
          </span>
        </p>
      </div>

      <div className="rounded-lg border border-[#2a2d35] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2d35] bg-[#13151b] text-left text-[#6b7280] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">Check</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2d35]">
            {Object.entries(health.checks).map(([key, status]) => (
              <tr key={key} className="bg-[#1a1d24]">
                <td className="px-4 py-3 text-white">{CHECK_LABELS[key] ?? key}</td>
                <td className="px-4 py-3">
                  <StatusPill status={status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-[#2a2d35] bg-[#1a1d24] p-4 space-y-2 text-sm text-[#9ca3af]">
        <h2 className="text-sm font-semibold text-white">Cron schedule</h2>
        <ul className="space-y-1 font-mono text-xs">
          <li>/api/cron/fast — every 5 min (publish + signals)</li>
          <li>/api/cron/medium — every 15 min (engagement, events, metrics)</li>
          <li>/api/cron/auto-generate — daily 8 UTC</li>
          <li>/api/cron/intelligence-sync — daily 2 UTC</li>
        </ul>
        <p className="text-xs text-[#6b7280] pt-2">
          Probe: <code className="text-[#93c5fd]">GET /api/health</code>
        </p>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: 'ok' | 'missing' | 'degraded' }) {
  const styles = {
    ok: 'bg-emerald-500/20 text-emerald-400',
    missing: 'bg-red-500/20 text-red-400',
    degraded: 'bg-amber-500/20 text-amber-400',
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
