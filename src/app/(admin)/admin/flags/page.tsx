import { assertAdmin } from '@/lib/admin';
import { getAdminFeatureFlags } from '@/lib/admin-data';
import { FlagToggle } from '@/components/admin/FlagToggle';

/**
 * Feature flag kill switches — flip without redeploy.
 */
export default async function AdminFlagsPage() {
  await assertAdmin();
  const flags = await getAdminFeatureFlags();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Feature Flags</h1>
        <p className="text-sm text-[#6b7280] mt-1">
          Runtime kill switches checked by cron jobs and feature modules
        </p>
      </div>

      {flags.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
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
