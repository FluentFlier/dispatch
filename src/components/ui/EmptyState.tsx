import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

/**
 * Presentational empty-state placeholder. Used when a list or panel has no
 * content to show. Purely visual - the caller decides when to render it and
 * supplies any optional call-to-action.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-hair2 bg-paper2/40 px-6 py-10 text-center ${className}`}
    >
      {Icon ? (
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-paper2 text-ink3">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-ink3">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
