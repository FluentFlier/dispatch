import { Suspense } from 'react';
import { assertAdmin } from '@/lib/admin';
import { getAdminUsers } from '@/lib/admin-data';
import { SubscriptionEditor } from '@/components/admin/SubscriptionEditor';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { UserSearchForm } from '@/components/admin/UserSearchForm';
import { ImpersonateButton } from '@/components/admin/ImpersonateButton';
import { adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * User directory with search, filters, subscription overrides, and impersonation.
 */
export default async function AdminUsersPage({ searchParams }: PageProps) {
  await assertAdmin();

  const q = param(searchParams.q);
  const plan = param(searchParams.plan);
  const status = param(searchParams.status);
  const onboardingRaw = param(searchParams.onboarding);
  const onboarding =
    onboardingRaw === 'complete' || onboardingRaw === 'incomplete' ? onboardingRaw : undefined;

  const users = await getAdminUsers({
    q,
    plan,
    status,
    onboarding,
    limit: 150,
  });

  const filterActive = Boolean(q || plan || status || onboarding);

  return (
    <div className={adminPage}>
      <AdminPageHeader
        title="Users"
        description={
          filterActive
            ? `${users.length} match${users.length === 1 ? '' : 'es'}`
            : `${users.length} accounts (most recent first)`
        }
      />

      <Suspense fallback={null}>
        <UserSearchForm />
      </Suspense>

      <div className={adminTableWrap}>
        <table className="w-full text-sm">
          <thead>
            <tr className={adminTableHead}>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Onboarding</th>
              <th className="px-4 py-3 font-medium">Plan / Status</th>
              <th className="px-4 py-3 font-medium">Posts</th>
              <th className="px-4 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.userId} className={adminTableRow}>
                <td className="px-4 py-3">
                  <p className="font-medium text-text-primary">{u.displayName}</p>
                  <p className="font-mono text-[11px] text-text-tertiary" title={u.userId}>
                    {shortId(u.userId)}
                  </p>
                  <ImpersonateButton userId={u.userId} displayName={u.displayName} />
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      u.onboardingComplete
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {u.onboardingComplete ? 'Complete' : 'Incomplete'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <SubscriptionEditor userId={u.userId} plan={u.plan} status={u.status} />
                  {u.trialEndsAt ? (
                    <p className="text-[10px] text-text-tertiary mt-1">
                      Trial ends {new Date(u.trialEndsAt).toLocaleDateString()}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-text-primary tabular-nums">{u.postCount}</td>
                <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 ? (
          <p className="p-8 text-center text-text-secondary">No users found</p>
        ) : null}
      </div>
    </div>
  );
}
