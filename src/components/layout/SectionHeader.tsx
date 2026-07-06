import type { ReactNode } from 'react';

interface SectionHeaderProps {
  tag: string;
  title: string;
  subtitle?: string;
  /** Accent dot color — matches landing section themes (blue, teal, flame). */
  accent?: string;
  action?: ReactNode;
  className?: string;
}

/** Landing-style section opener: pill tag + semibold headline. */
export function SectionHeader({
  tag,
  title,
  subtitle,
  accent = '#2563EB',
  action,
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div>
        <span className="inline-flex items-center gap-2 rounded-full border border-hair bg-white/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink2 shadow-sm backdrop-blur-sm">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
            style={{ backgroundColor: accent, color: accent }}
            aria-hidden
          />
          {tag}
        </span>
        <h2 className="mt-4 text-[clamp(22px,2.5vw,28px)] font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink2">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
