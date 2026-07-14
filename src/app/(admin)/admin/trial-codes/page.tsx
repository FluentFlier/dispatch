import { assertAdmin } from '@/lib/admin';
import { getTrialCodes } from '@/lib/admin-data';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { CreateTrialCodeForm } from '@/components/admin/CreateTrialCodeForm';
import { TrialCodeRowActions } from '@/components/admin/TrialCodeRowActions';
import { adminCard, adminPage, adminTableHead, adminTableRow, adminTableWrap } from '@/components/admin/admin-ui';

/**
 * Trial access codes: create/remove reusable campaign codes, each granting a
 * specific trial length and plan tier.
 */
export default async function AdminTrialCodesPage() {
  await assertAdmin();
  const codes = await getTrialCodes();

  return (
    <div className={adminPage}>
      <AdminPageHeader
        title="Trial codes"
        description="Reusable access codes that unlock a free trial. Each code sets its own length and plan."
      />

      <div className={adminCard}>
        <h2 className="mb-3 text-sm font-semibold text-ink">Create a code</h2>
        <CreateTrialCodeForm />
      </div>

      <div className={adminTableWrap}>
        <table className="w-full text-sm">
          <thead>
            <tr className={adminTableHead}>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Trial days</th>
              <th className="px-4 py-3 font-medium">Redemptions</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Note</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {codes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink3">
                  No codes yet. Create one above.
                </td>
              </tr>
            ) : (
              codes.map((c) => (
                <tr key={c.code} className={adminTableRow}>
                  <td className="px-4 py-3 font-mono text-[13px] font-medium text-ink">{c.code}</td>
                  <td className="px-4 py-3 text-ink2">{c.plan}</td>
                  <td className="px-4 py-3 text-ink2 tabular-nums">{c.trialDays}</td>
                  <td className="px-4 py-3 text-ink2 tabular-nums">
                    {c.redemptionCount}
                    {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        c.active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      {c.active ? 'active' : 'disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink3 text-xs max-w-[200px] truncate" title={c.note ?? ''}>
                    {c.note ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <TrialCodeRowActions code={c.code} active={c.active} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
