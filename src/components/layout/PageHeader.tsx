import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional mono eyebrow shown above the title, e.g. "GENERATE" or "01 / STUDIO". */
  eyebrow?: string;
  action?: ReactNode;
}

/**
 * Editorial page header: pill eyebrow + semibold display title (landing-style).
 */
export function PageHeader({ title, subtitle, eyebrow, action }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
