'use client';

import { ChevronDown, ChevronUp, Trash2, Layers } from 'lucide-react';
import type { Series } from '@/lib/types';
import { usePillars } from '@/hooks/usePillars';

interface SeriesProgressSummary {
  posted: number;
  inProduction: number;
  total: number;
}

interface SeriesCardProps {
  series: Series;
  progress: SeriesProgressSummary;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  children?: React.ReactNode;
}

export default function SeriesCard({
  series,
  progress,
  isExpanded,
  onToggleExpand,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  children,
}: SeriesCardProps) {
  const { getColor, getLabel } = usePillars();
  const { posted, inProduction, total } = progress;
  const pct = total > 0 ? (posted / total) * 100 : 0;
  const pillarColor = getColor(series.pillar);

  return (
    <div className="card-surface overflow-hidden p-0">
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="w-full rounded-t-surface p-5 text-left transition-colors hover:bg-paper2/50 md:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-title text-ink">{series.name}</h2>
              <span
                className="inline-flex items-center rounded-badge px-2.5 py-1 text-[12px] font-medium"
                style={{ backgroundColor: `${pillarColor}1f`, color: pillarColor }}
              >
                {getLabel(series.pillar)}
              </span>
            </div>

            {series.description && !isExpanded && (
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink2">
                {series.description}
              </p>
            )}

            {/* Progress */}
            <div className="mt-4 max-w-xl space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-paper2">
                <div
                  className="h-full rounded-full bg-ink transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[13px] text-ink3">
                <span className="font-medium text-ink2">{posted}</span> of {total} posted
                {inProduction > 0 && <> · {inProduction} in production</>}
              </p>
            </div>
          </div>

          <span className="mt-1 shrink-0 text-ink3">
            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </span>
        </div>
      </button>

      {/* Expanded */}
      {isExpanded && (
        <div className="border-t border-hair p-5 md:p-6">
          {series.description && (
            <p className="mb-5 max-w-3xl text-sm leading-relaxed text-ink2">{series.description}</p>
          )}

          <div className="mb-5 flex items-center gap-2 text-ink3">
            <Layers className="h-4 w-4" />
            <span className="section-label">Parts</span>
          </div>

          {children}

          <div className="flex justify-end pt-5">
            {confirmingDelete ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-ink2">Delete this series?</span>
                <button
                  onClick={onDelete}
                  className="rounded-control bg-flame/10 px-3 py-1.5 font-medium text-flame transition-opacity hover:opacity-80"
                >
                  Confirm
                </button>
                <button
                  onClick={onCancelDelete}
                  className="px-2 py-1.5 text-ink3 transition-colors hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={onConfirmDelete}
                className="inline-flex items-center gap-1.5 text-sm text-ink3 transition-colors hover:text-flame"
              >
                <Trash2 className="h-4 w-4" />
                Delete series
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
