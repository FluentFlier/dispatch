interface AdminStatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  variant?: 'default' | 'warning' | 'danger' | 'success';
}

const VARIANT_STYLES = {
  default: 'border-[#2a2d35] bg-[#1a1d24]',
  warning: 'border-amber-500/30 bg-amber-500/10',
  danger: 'border-red-500/30 bg-red-500/10',
  success: 'border-emerald-500/30 bg-emerald-500/10',
} as const;

/**
 * KPI card for admin overview grids.
 */
export function AdminStatCard({
  label,
  value,
  sub,
  variant = 'default',
}: AdminStatCardProps) {
  return (
    <div className={`rounded-lg border p-4 ${VARIANT_STYLES[variant]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">{label}</p>
      <p className="text-2xl font-semibold text-white mt-1 tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-[#6b7280] mt-1">{sub}</p> : null}
    </div>
  );
}
