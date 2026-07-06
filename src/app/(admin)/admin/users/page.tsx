import { assertAdmin } from '@/lib/admin';
import { getAdminUsers } from '@/lib/admin-data';
import { SubscriptionEditor } from '@/components/admin/SubscriptionEditor';

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

/**
 * User directory with subscription overrides and onboarding status.
 */
export default async function AdminUsersPage() {
  await assertAdmin();
  const users = await getAdminUsers(150);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Users</h1>
        <p className="text-sm text-[#6b7280] mt-1">{users.length} accounts (most recent first)</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2a2d35]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2d35] bg-[#13151b] text-left text-[#6b7280] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Onboarding</th>
              <th className="px-4 py-3 font-medium">Plan / Status</th>
              <th className="px-4 py-3 font-medium">Posts</th>
              <th className="px-4 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2d35]">
            {users.map((u) => (
              <tr key={u.userId} className="bg-[#1a1d24] hover:bg-[#1f2229]">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{u.displayName}</p>
                  <p className="font-mono text-[11px] text-[#6b7280]" title={u.userId}>
                    {shortId(u.userId)}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      u.onboardingComplete
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {u.onboardingComplete ? 'Complete' : 'Incomplete'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <SubscriptionEditor userId={u.userId} plan={u.plan} status={u.status} />
                  {u.trialEndsAt ? (
                    <p className="text-[10px] text-[#6b7280] mt-1">
                      Trial ends {new Date(u.trialEndsAt).toLocaleDateString()}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-white tabular-nums">{u.postCount}</td>
                <td className="px-4 py-3 text-[#9ca3af] whitespace-nowrap">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 ? (
          <p className="p-8 text-center text-[#6b7280]">No users found</p>
        ) : null}
      </div>
    </div>
  );
}
