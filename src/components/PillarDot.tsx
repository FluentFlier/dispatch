'use client';

import { PILLAR_COLORS, PILLAR_LABELS } from '@/lib/constants';
import type { Pillar } from '@/lib/constants';
import { normalizePillarSlug } from '@/lib/pillars';

interface PillarDotProps {
  pillar: string;
  showLabel?: boolean;
  /** Override color (used by dynamic pillars). */
  color?: string;
  /** Override label (used by dynamic pillars). */
  label?: string;
}

export default function PillarDot({ pillar, showLabel = false, color, label }: PillarDotProps) {
  const slug = normalizePillarSlug(pillar);
  const resolvedColor = color ?? PILLAR_COLORS[slug as Pillar] ?? '#71717A';
  const resolvedLabel =
    label ??
    PILLAR_LABELS[slug as Pillar] ??
    slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: resolvedColor }}
      />
      {showLabel && (
        <span
          className="text-[11px] font-medium"
          style={{ color: resolvedColor }}
        >
          {resolvedLabel}
        </span>
      )}
    </span>
  );
}
