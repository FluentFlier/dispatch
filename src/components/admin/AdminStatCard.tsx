interface AdminStatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  variant?: 'default' | 'warning' | 'danger' | 'success';
}

const VARIANT_STYLES = {
  default: 'border-border bg-bg-secondary',
  warning: 'border-amber-200 bg-amber-50',
  danger: 'border-red-200 bg-red-50',
  success: 'border-emerald-200 bg-emerald-50',
} as const;

const VALUE_STYLES = {
  default: 'text-text-primary',
  warning: 'text-amber-900',
  danger: 'text-red-900',
  success: 'text-emerald-900',
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
    <div className={`rounded-lg border p-4 shadow-card ${VARIANT_STYLES[variant]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`text-2xl font-semibold mt-1 tabular-nums ${VALUE_STYLES[variant]}`}>{value}</p>
      {sub ? <p className="text-xs text-text-secondary mt-1">{sub}</p> : null}
    </div>
  );
}
