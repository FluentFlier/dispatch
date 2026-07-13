'use client';

import { usePillars } from '@/hooks/usePillars';
import { weightedPillars, clampWeight, DEFAULT_PILLAR_WEIGHT } from '@/lib/pillars';

interface PillarMultiSelectProps {
  /** Currently selected pillar slugs. */
  pillars: string[];
  /** Per-pillar importance map (slug -> 1-100). */
  weights: Record<string, number>;
  /**
   * Fires with the next selection AND weights whenever the user toggles a pillar
   * or drags a weight. `pillars` is returned primary-first (highest weight first)
   * so callers can persist `pillar = pillars[0]` without extra work.
   */
  onChange: (next: { pillars: string[]; weights: Record<string, number> }) => void;
  /** Show the per-pillar emphasis sliders. Default true. */
  showWeights?: boolean;
}

/**
 * Reusable multi-pillar picker with per-pillar importance weights.
 *
 * Used anywhere a post/idea's pillars are chosen (Library drawer, Save-to-Library
 * modal, idea form). Selecting chips sets membership; the sliders set 1-100
 * emphasis that downstream AI generation + hook retrieval consume. Selection is
 * always returned primary-first so the synced single `pillar` stays the
 * highest-weight one.
 */
export default function PillarMultiSelect({
  pillars,
  weights,
  onChange,
  showWeights = true,
}: PillarMultiSelectProps) {
  const { pillars: pillarList, getLabel } = usePillars();

  // Order selection primary-first by weight so the displayed "(primary)" marker
  // and persisted pillars[0] agree with the weights.
  const ordered = weightedPillars({ pillars, pillar_weights: weights }).map((w) => w.slug);

  function emit(nextPillars: string[], nextWeights: Record<string, number>) {
    const reordered = weightedPillars({ pillars: nextPillars, pillar_weights: nextWeights }).map(
      (w) => w.slug,
    );
    onChange({ pillars: reordered, weights: nextWeights });
  }

  function toggle(slug: string) {
    const has = ordered.includes(slug);
    if (has) {
      const next = ordered.filter((p) => p !== slug);
      const nextWeights = { ...weights };
      delete nextWeights[slug];
      // Never allow an empty selection.
      if (next.length === 0) return;
      emit(next, nextWeights);
    } else {
      const next = [...ordered, slug];
      emit(next, { ...weights, [slug]: weights[slug] ?? DEFAULT_PILLAR_WEIGHT });
    }
  }

  function setWeight(slug: string, value: number) {
    emit(ordered, { ...weights, [slug]: clampWeight(value) });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {pillarList.map((p) => {
          const active = ordered.includes(p.value);
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => toggle(p.value)}
              className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
                active
                  ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                  : 'border-border text-text-secondary hover:border-border-hover'
              }`}
            >
              {p.label}
              {active && ordered[0] === p.value ? ' (primary)' : ''}
            </button>
          );
        })}
      </div>

      {showWeights && ordered.length > 0 && (
        <div className="space-y-2 rounded-md border border-border bg-bg-secondary p-3">
          <span className="text-[11px] text-text-secondary font-medium tracking-wide">
            Emphasis (how much each topic matters)
          </span>
          {ordered.map((slug, i) => (
            <div key={slug} className="flex items-center gap-3">
              <span className="text-[12px] text-text-primary w-32 shrink-0 truncate">
                {getLabel(slug)}
                {i === 0 ? <span className="text-text-tertiary"> (primary)</span> : ''}
              </span>
              <input
                type="range"
                min={1}
                max={100}
                value={weights[slug] ?? DEFAULT_PILLAR_WEIGHT}
                onChange={(e) => setWeight(slug, Number(e.target.value))}
                className="flex-1 accent-accent-primary"
                aria-label={`${getLabel(slug)} importance`}
              />
              <span className="text-[11px] text-text-secondary w-8 text-right tabular-nums">
                {weights[slug] ?? DEFAULT_PILLAR_WEIGHT}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
