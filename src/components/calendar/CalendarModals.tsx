'use client';

import { X, Sparkles } from 'lucide-react';
import type { Post } from '@/lib/types';
import PillarDot from '@/components/PillarDot';

/* ------------------------------------------------------------------ */
/*  Schedule Modal                                                     */
/* ------------------------------------------------------------------ */

interface ScheduleModalProps {
  date: Date;
  backlog: Post[];
  onSchedule: (postId: string) => void;
  onClose: () => void;
}

export function ScheduleModal({
  date,
  backlog,
  onSchedule,
  onClose,
}: ScheduleModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-secondary border border-hair rounded-lg w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-hair">
          <h3 className="font-serif text-[18px] font-normal tracking-[-0.025em] text-ink">
            Schedule for{" "}
            {date.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {backlog.length === 0 ? (
            <p className="text-[13px] text-text-secondary text-center py-8">
              No unscheduled posts available.
            </p>
          ) : (
            <div className="space-y-2">
              {backlog.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSchedule(p.id)}
                  className="w-full text-left rounded-lg border border-border bg-bg-secondary p-3 hover:border-border-hover transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <PillarDot pillar={p.pillar} showLabel />
                    <span className="text-[13px] text-text-primary font-medium truncate">
                      {p.title}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fill Week Modal                                                    */
/* ------------------------------------------------------------------ */

interface FillSuggestion {
  postId: string;
  date: string;
  title: string;
  pillar: string;
}

interface FillWeekModalProps {
  loading: boolean;
  suggestions: FillSuggestion[];
  getLabel: (pillar: string) => string;
  onConfirm: () => void;
  onClose: () => void;
}

export function FillWeekModal({
  loading,
  suggestions,
  getLabel,
  onConfirm,
  onClose,
}: FillWeekModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-secondary border border-hair rounded-lg w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-hair">
          <h3 className="font-serif text-[18px] font-normal tracking-[-0.025em] text-ink">
            Fill This Week
          </h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Sparkles className="w-6 h-6 text-accent-primary animate-pulse" />
              <p className="text-[13px] text-text-secondary">
                AI is suggesting a schedule...
              </p>
            </div>
          ) : suggestions.length === 0 ? (
            <p className="text-[13px] text-text-secondary text-center py-8">
              No suggestions generated. Try again or schedule manually.
            </p>
          ) : (
            <div className="space-y-2 mb-4">
              {suggestions.map((s) => (
                <div
                  key={s.postId}
                  className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary p-3"
                >
                  <PillarDot pillar={s.pillar} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-text-primary font-medium truncate">
                      {s.title}
                    </p>
                    <p className="text-[11px] text-text-secondary">
                      {getLabel(s.pillar)}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-ink3 whitespace-nowrap">
                    {new Date(s.date + "T12:00:00").toLocaleDateString(
                      "en-US",
                      { weekday: "short", month: "short", day: "numeric" }
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {suggestions.length > 0 && !loading && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-hair">
            <button
              onClick={onClose}
              className="px-[14px] py-[7px] text-[13px] text-text-secondary hover:text-text-primary border border-border rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-5 py-[10px] text-[13px] font-medium bg-accent-primary text-white rounded-md hover:opacity-90 transition-opacity"
            >
              Apply Schedule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
