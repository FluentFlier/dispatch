import { assertAdmin } from '@/lib/admin';
import { getAdminPublishJobs } from '@/lib/admin-data';
import { RetryJobButton } from '@/components/admin/RetryJobButton';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

const STATUS_COLORS: Record<string, string> = {
  queued: 'text-text-secondary',
  processing: 'text-accent-primary',
  published: 'text-emerald-700',
  failed: 'text-amber-700',
  dead: 'text-red-700',
};

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

/**
 * Publish queue monitor: failed/dead jobs with admin retry.
 */
export default async function AdminPublishPage() {
  await assertAdmin();
  const [failed, allRecent] = await Promise.all([
    getAdminPublishJobs(['failed', 'dead'], 50),
    getAdminPublishJobs(undefined, 30),
  ]);

  return (
    <div className={`${adminPage} space-y-8`}>
      <AdminPageHeader
        title="Publish Queue"
        description="Monitor and retry failed publish jobs · cron runs every 5 min"
      />

      <section>
        <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          Needs attention
          {failed.length > 0 ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 font-medium">
              {failed.length}
            </span>
          ) : null}
        </h2>
        <JobTable jobs={failed} showRetry />
        {failed.length === 0 ? (
          <p className="text-sm text-emerald-700 py-4">No failed or dead jobs</p>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text-primary mb-3">Recent activity</h2>
        <JobTable jobs={allRecent} />
      </section>
    </div>
  );
}

function JobTable({
  jobs,
  showRetry = false,
}: {
  jobs: Awaited<ReturnType<typeof getAdminPublishJobs>>;
  showRetry?: boolean;
}) {
  if (jobs.length === 0) return null;

  return (
    <div className={adminTableWrap}>
      <table className="w-full text-sm">
        <thead>
          <tr className={adminTableHead}>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Platform</th>
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Attempts</th>
            <th className="px-4 py-3 font-medium">Error</th>
            <th className="px-4 py-3 font-medium">Updated</th>
            {showRetry ? <th className="px-4 py-3 font-medium" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((j) => (
            <tr key={j.id} className={adminTableRow}>
              <td className={`px-4 py-3 font-medium ${STATUS_COLORS[j.status] ?? 'text-text-primary'}`}>
                {j.status}
              </td>
              <td className="px-4 py-3 text-text-primary">{j.platform}</td>
              <td className="px-4 py-3 font-mono text-[11px] text-text-tertiary" title={j.userId}>
                {shortId(j.userId)}
              </td>
              <td className="px-4 py-3 text-text-secondary tabular-nums">
                {j.attempts}/{j.maxAttempts}
              </td>
              <td className="px-4 py-3 text-xs text-red-700 max-w-xs truncate" title={j.lastError ?? ''}>
                {j.lastError ?? '—'}
              </td>
              <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                {new Date(j.updatedAt).toLocaleString()}
              </td>
              {showRetry ? (
                <td className="px-4 py-3">
                  <RetryJobButton jobId={j.id} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
