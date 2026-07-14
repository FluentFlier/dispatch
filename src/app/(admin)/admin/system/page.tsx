import { assertAdmin } from '@/lib/admin';
import { getAdminSystemHealth } from '@/lib/admin-data';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminCard, adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';
import { PRODUCT_NAME } from '@/lib/brand';

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
  const health = getAdminSystemHealth();

  return (
    <div className={`${adminPage} max-w-3xl`}>
      <AdminPageHeader
        title="System"
        description={`${PRODUCT_NAME} dependency checks · ${new Date(health.timestamp).toLocaleString()}`}
      />

      <div className={`rounded-lg border p-4 ${
          health.status === 'ok'
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-amber-200 bg-amber-50'
        }`}
      >
        <p className="text-lg font-semibold text-text-primary capitalize">{health.status}</p>
        <p className="text-sm text-text-secondary mt-1">
          Social provider: <span className="font-mono text-text-primary">{health.provider}</span>
        </p>
        <p className="text-sm text-text-secondary">
          Admin allowlist:{' '}
          <span className={health.adminEmailsConfigured ? 'text-emerald-700' : 'text-red-700'}>
            {health.adminEmailsConfigured ? 'configured' : 'ADMIN_EMAILS not set'}
          </span>
        </p>
      </div>

      <div className={adminTableWrap}>
        <table className="w-full text-sm">
          <thead>
            <tr className={adminTableHead}>
              <th className="px-4 py-3 font-medium">Check</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(health.checks).map(([key, status]) => (
              <tr key={key} className={adminTableRow}>
                <td className="px-4 py-3 text-text-primary">{CHECK_LABELS[key] ?? key}</td>
                <td className="px-4 py-3">
                  <StatusPill status={status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={`${adminCard} space-y-2 text-sm text-text-secondary`}>
        <h2 className="text-sm font-semibold text-text-primary">Cron schedule</h2>
        <ul className="space-y-1 font-mono text-xs">
          <li>/api/cron/fast - every 5 min (publish + signals)</li>
          <li>/api/cron/medium - every 15 min (engagement, events, metrics)</li>
          <li>/api/cron/auto-generate - daily 8 UTC</li>
          <li>/api/cron/intelligence-sync - daily 2 UTC</li>
        </ul>
        <p className="text-xs text-text-tertiary pt-2">
          Probe: <code className="text-accent-primary">GET /api/health</code>
        </p>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: 'ok' | 'missing' | 'degraded' }) {
  const styles = {
    ok: 'bg-emerald-100 text-emerald-800',
    missing: 'bg-red-100 text-red-800',
    degraded: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
