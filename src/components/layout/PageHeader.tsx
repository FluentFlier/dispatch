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
        {eyebrow ? (
          <span className="mb-3 inline-flex items-center gap-2 rounded-badge border border-hair bg-white/80 px-3 py-1.5 text-[11.5px] font-semibold tracking-[0.01em] text-ink2 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue" aria-hidden />
            {eyebrow}
          </span>
        ) : null}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
