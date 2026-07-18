'use client';

import { Check } from 'lucide-react';
import type { Status } from '@/lib/constants';
import { SERIES_STAGES } from '@/lib/series-stages';

interface StageStepperProps {
  currentIndex: number;
  /** Advance the part to a status-backed stage. Derived stages aren't clickable. */
  onSetStatus: (status: Status) => void;
  disabled?: boolean;
}

/**
 * Horizontal production pipeline: Planned -> ... -> Posted. Status-backed stages
 * are clickable to advance (or step back); Captioned/Scheduled/Posted are reached
 * through their real actions (write a caption, schedule, publish) so they render
 * as read-only markers.
 */
export function StageStepper({ currentIndex, onSetStatus, disabled }: StageStepperProps) {
  return (
    <ol className="flex w-full items-start gap-1.5 overflow-x-auto">
      {SERIES_STAGES.map((stage, i) => {
        const reached = i <= currentIndex;
        const isCurrent = i === currentIndex;
        const clickable = stage.status !== null && stage.id !== 'posted' && !disabled;

        const node = (
          <span
            className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold tabular-nums transition-colors',
              reached
                ? 'border-ink bg-ink text-paper'
                : 'border-hair bg-white/70 text-ink3',
              isCurrent ? 'ring-2 ring-blue/40 ring-offset-1 ring-offset-paper' : '',
            ].join(' ')}
          >
            {reached && !isCurrent ? <Check className="h-4 w-4" /> : i + 1}
          </span>
        );

        return (
          <li key={stage.id} className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
            {clickable ? (
              <button
                type="button"
                onClick={() => stage.status && onSetStatus(stage.status)}
                title={stage.hint}
                aria-label={`Mark part as ${stage.label}`}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40"
              >
                {node}
              </button>
            ) : (
              <span title={stage.hint}>{node}</span>
            )}
            <span
              className={`truncate text-[12px] leading-tight ${
                reached ? 'font-medium text-ink' : 'text-ink3'
              }`}
            >
              {stage.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
