'use client';

import { ChevronDown, ChevronUp, Pause, Play, Trash2 } from 'lucide-react';
import type { Series } from '@/lib/types';
import { usePillars } from '@/hooks/usePillars';

interface SeriesCardProps {
  series: Series;
  completedParts: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onPauseResume?: () => void;
  children?: React.ReactNode;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'text-green-600 bg-green-600/10',
  paused: 'text-amber-600 bg-amber-600/10',
  completed: 'text-text-secondary bg-bg-tertiary',
  draft: 'text-text-secondary bg-bg-tertiary',
};

export default function SeriesCard({
  series,
  completedParts,
  isExpanded,
  onToggleExpand,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onPauseResume,
  children,
}: SeriesCardProps) {
  const { getColor, getLabel } = usePillars();
  const total = series.total_parts;
  const progress = total > 0 ? (completedParts / total) * 100 : 0;
  const pillarColor = getColor(series.pillar);
  const status = series.status ?? 'draft';

  return (
    <div
      className={`bg-bg-secondary border border-border rounded-lg transition-all ${
        isExpanded ? 'md:col-span-2' : ''
      }`}
    >
      {/* Card header */}
      <button
        onClick={onToggleExpand}
        className="w-full text-left p-[13px_14px] hover:bg-bg-tertiary rounded-t-[12px] transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-[18px] font-normal tracking-[-0.02em] text-ink truncate">
                {series.name}
              </h3>
              <span
                className="inline-flex items-center px-[7px] py-[2px] rounded-[3px] text-[10px] font-medium shrink-0 tracking-[0.01em]"
                style={{
                  backgroundColor: `${pillarColor}20`,
                  color: pillarColor,
                  fontFamily: "'Space Grotesk', sans-serif",
                }}
              >
                {getLabel(series.pillar)}
              </span>
              {status !== 'draft' && (
                <span className={`inline-flex items-center px-[7px] py-[2px] rounded-[3px] text-[10px] font-medium shrink-0 capitalize ${STATUS_STYLE[status] ?? ''}`}>
                  {status}
                </span>
              )}
            </div>

            {series.description && (
              <p className="text-[13px] text-text-tertiary line-clamp-2 mb-3 leading-[1.55]">
                {series.description}
              </p>
            )}

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] tracking-[0.08em] text-ink3">
                {completedParts} of {total} parts complete
              </p>
            </div>
          </div>

          <div className="shrink-0 mt-1 text-text-secondary">
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </div>
      </button>

      {/* Expanded view */}
      {isExpanded && (
        <div className="border-t border-hair p-[13px_14px] space-y-4">
          {series.description && (
            <p className="text-[13px] text-text-tertiary leading-[1.55]">{series.description}</p>
          )}

          {children}

          {/* Pause/resume + delete */}
          <div className="flex justify-between items-center pt-2">
            {onPauseResume && (status === 'active' || status === 'paused') ? (
              <button
                onClick={onPauseResume}
                className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
              >
                {status === 'active' ? <><Pause size={13} /> Pause series</> : <><Play size={13} /> Resume series</>}
              </button>
            ) : <span />}
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-secondary">
                  Delete this series?
                </span>
                <button
                  onClick={onDelete}
                  className="px-3 py-1 rounded-[3px] text-[10px] font-medium bg-coral-light text-accent-primary hover:opacity-80 transition-opacity"
                >
                  Confirm
                </button>
                <button
                  onClick={onCancelDelete}
                  className="px-3 py-1 rounded-[3px] text-[10px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={onConfirmDelete}
                className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-accent-primary transition-colors"
              >
                <Trash2 size={13} />
                Delete Series
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
