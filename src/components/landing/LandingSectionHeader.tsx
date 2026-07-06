interface Props {
  tag: string;
  title: string;
  subtitle?: string;
  accent?: string;
  variant?: 'light' | 'dark';
  className?: string;
}

/** Themed section opener — pill tag + headline + optional lede. */
export default function LandingSectionHeader({
  tag,
  title,
  subtitle,
  accent = '#2563EB',
  variant = 'light',
  className = '',
}: Props) {
  const dark = variant === 'dark';

  return (
    <div className={`max-w-xl ${className}`}>
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] shadow-sm backdrop-blur-sm ${
          dark
            ? 'border-paper/15 bg-paper/5 text-paper/70'
            : 'border-hair bg-white/80 text-ink2'
        }`}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
          style={{ backgroundColor: accent, color: accent }}
          aria-hidden
        />
        {tag}
      </span>
      <h2
        className={`m-0 mt-4 text-[clamp(26px,3.5vw,40px)] font-semibold tracking-[-0.03em] ${
          dark ? 'text-paper' : 'text-ink'
        }`}
      >
        {title}
      </h2>
      {subtitle ? (
        <p className={`m-0 mt-3 text-[15px] leading-relaxed ${dark ? 'text-paper/60' : 'text-ink2'}`}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
