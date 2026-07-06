import { assertAdmin } from '@/lib/admin';
import { getAdminPublishJobs } from '@/lib/admin-data';
import { RetryJobButton } from '@/components/admin/RetryJobButton';

const STATUS_COLORS: Record<string, string> = {
  queued: 'text-[#9ca3af]',
  processing: 'text-[#93c5fd]',
  published: 'text-emerald-400',
  failed: 'text-amber-400',
  dead: 'text-red-400',
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
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Publish Queue</h1>
        <p className="text-sm text-[#6b7280] mt-1">
          Monitor and retry failed publish jobs · cron runs every 5 min
        </p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          Needs attention
          {failed.length > 0 ? (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
              {failed.length}
            </span>
          ) : null}
        </h2>
        <JobTable jobs={failed} showRetry />
        {failed.length === 0 ? (
          <p className="text-sm text-emerald-400/80 py-4">No failed or dead jobs</p>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white mb-3">Recent activity</h2>
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
    <div className="overflow-x-auto rounded-lg border border-[#2a2d35]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#2a2d35] bg-[#13151b] text-left text-[#6b7280] text-xs uppercase tracking-wide">
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Platform</th>
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Attempts</th>
            <th className="px-4 py-3 font-medium">Error</th>
            <th className="px-4 py-3 font-medium">Updated</th>
            {showRetry ? <th className="px-4 py-3 font-medium" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#2a2d35]">
          {jobs.map((j) => (
            <tr key={j.id} className="bg-[#1a1d24]">
              <td className={`px-4 py-3 font-medium ${STATUS_COLORS[j.status] ?? 'text-white'}`}>
                {j.status}
              </td>
              <td className="px-4 py-3 text-white">{j.platform}</td>
              <td className="px-4 py-3 font-mono text-[11px] text-[#6b7280]" title={j.userId}>
                {shortId(j.userId)}
              </td>
              <td className="px-4 py-3 text-[#9ca3af] tabular-nums">
                {j.attempts}/{j.maxAttempts}
              </td>
              <td className="px-4 py-3 text-xs text-red-300/80 max-w-xs truncate" title={j.lastError ?? ''}>
                {j.lastError ?? '—'}
              </td>
              <td className="px-4 py-3 text-[#9ca3af] text-xs whitespace-nowrap">
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
