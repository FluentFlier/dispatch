import { assertAdmin } from '@/lib/admin';
import { getAdminFeatureFlags } from '@/lib/admin-data';
import { FlagToggle } from '@/components/admin/FlagToggle';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { adminPage } from '@/components/admin/admin-ui';

/**
 * Feature flag kill switches - flip without redeploy.
 */
export default async function AdminFlagsPage() {
  await assertAdmin();
  const flags = await getAdminFeatureFlags();

  return (
    <div className={`${adminPage} max-w-2xl`}>
      <AdminPageHeader
        title="Feature Flags"
        description="Runtime kill switches checked by cron jobs and feature modules"
      />

      {flags.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No feature flags in database. Run <code className="font-mono">db/signals.sql</code> to seed{' '}
          <code className="font-mono">signals_engine</code>.
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => (
            <FlagToggle key={f.name} name={f.name} enabled={f.enabled} description={f.description} />
          ))}
        </div>
      )}
    </div>
  );
}
