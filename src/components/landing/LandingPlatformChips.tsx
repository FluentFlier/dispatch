const PLATFORMS = [
  { id: 'x', label: 'X', mark: '𝕏' },
  { id: 'linkedin', label: 'LinkedIn', mark: 'in' },
] as const;

interface Props {
  size?: 'sm' | 'md';
  className?: string;
}

/** Branded platform chips - LinkedIn + X only. */
export default function LandingPlatformChips({ size = 'md', className = '' }: Props) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {PLATFORMS.map((p) => (
        <span
          key={p.id}
          className={`inline-flex items-center gap-1.5 rounded-full border border-hair bg-white/90 font-medium text-ink2 shadow-sm backdrop-blur-sm ${pad}`}
        >
          <span
            className={`inline-flex items-center justify-center rounded-md bg-ink font-semibold text-paper ${
              size === 'sm' ? 'h-4 w-4 text-[9px]' : 'h-5 w-5 text-[10px]'
            }`}
          >
            {p.mark}
          </span>
          {p.label}
        </span>
      ))}
    </div>
  );
}
