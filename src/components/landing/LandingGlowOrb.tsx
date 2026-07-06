import type { SectionTheme } from './editorial/theme';
import { GLOW_CLASS } from './editorial/theme';

interface Props {
  tone: SectionTheme['glow'];
  position?: 'left' | 'right' | 'center';
  className?: string;
}

const POS = {
  left: '-left-32 top-1/3',
  right: '-right-32 top-1/2 -translate-y-1/2',
  center: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
} as const;

/** Soft accent orb — matches section theme glow. */
export default function LandingGlowOrb({
  tone,
  position = 'right',
  className = '',
}: Props) {
  if (tone === 'none') return null;

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute ${POS[position]} h-72 w-72 rounded-full blur-[100px] animate-land-drift-b ${GLOW_CLASS[tone]} ${className}`}
    />
  );
}
