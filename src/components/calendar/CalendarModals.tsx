'use client';

import { useState } from 'react';
import { X, Sparkles, Clock } from 'lucide-react';
import type { Post } from '@/lib/types';
import PillarDot from '@/components/PillarDot';

/* ------------------------------------------------------------------ */
/*  Schedule Modal                                                     */
/* ------------------------------------------------------------------ */

interface ScheduleModalProps {
  date: Date;
  backlog: Post[];
  /** Called with postId and HH:MM UTC time string */
  onSchedule: (postId: string, time: string) => void;
  onClose: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  threads: 'Threads',
};

/**
 * Quick-schedule modal: user picks a backlog post and a publish time for a specific day.
 * Mirrors Google Calendar's Quick Create modal adapted for Content OS.
 */
export function ScheduleModal({
  date,
  backlog,
  onSchedule,
  onClose,
}: ScheduleModalProps) {
  const [selectedTime, setSelectedTime] = useState('12:00');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-secondary border border-hair rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-hair">
          <div>
            <h3 className="font-serif text-[18px] font-normal tracking-[-0.025em] text-ink">
              Schedule a Post
            </h3>
            <p className="text-[12px] font-mono text-ink3 mt-0.5">
              {date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Time picker */}
        <div className="px-4 pt-3 pb-2 border-b border-hair">
          <label className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.1em] text-ink3 mb-1.5">
            <Clock className="w-3.5 h-3.5" />
            Publish time (UTC)
          </label>
          <input
            type="time"
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-primary transition-colors w-32"
          />
        </div>

        {/* Post list */}
        <div className="p-4 overflow-y-auto flex-1">
          <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink3 mb-3">
            Pick a post from backlog
          </p>
          {backlog.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-text-secondary">No unscheduled posts in backlog.</p>
              <p className="text-[12px] text-ink3 mt-1">Generate content first, then schedule it here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {backlog.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSchedule(p.id, selectedTime)}
                  className="w-full text-left rounded-lg border border-border bg-bg-secondary p-3 hover:border-accent-primary/60 hover:bg-bg-tertiary transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <PillarDot pillar={p.pillar} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text-primary font-medium truncate group-hover:text-ink">
                        {p.title}
                      </p>
                      <p className="text-[11px] font-mono text-ink3 uppercase tracking-[0.06em] mt-0.5">
                        {PLATFORM_LABELS[p.platform] ?? p.platform}
                      </p>
                    </div>
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

/**
 * AI Fill This Week modal — shows suggestions before applying.
 */
export function FillWeekModal({
  loading,
  suggestions,
  getLabel,
  onConfirm,
  onClose,
}: FillWeekModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-secondary border border-hair rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-hair">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent-primary" />
            <h3 className="font-serif text-[18px] font-normal tracking-[-0.025em] text-ink">
              AI Week Fill
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Sparkles className="w-6 h-6 text-accent-primary animate-pulse" />
              <p className="text-[13px] text-text-secondary">
                AI is building your schedule...
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
                    {new Date(s.date + 'T12:00:00Z').toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
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
              className="px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary border border-border rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-5 py-2 text-[13px] font-medium bg-accent-primary text-white rounded-md hover:opacity-90 transition-opacity"
            >
              Apply Schedule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
