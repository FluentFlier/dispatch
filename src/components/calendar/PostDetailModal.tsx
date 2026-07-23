'use client';

import { useState } from 'react';
import { X, Send, Calendar, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import type { Post } from '@/lib/types';
import { isPublished } from '@/lib/posts/published';
import PillarDot from '@/components/PillarDot';
import StatusBadge from '@/components/ui/StatusBadge';

/* ------------------------------------------------------------------ */
/*  Types & helpers                                                    */
/* ------------------------------------------------------------------ */

interface PostDetailModalProps {
  post: Post;
  onClose: () => void;
  onPublishNow: (post: Post) => Promise<void>;
  onReschedule: (postId: string, date: string, time: string) => Promise<void>;
  onUnschedule: (postId: string) => Promise<void>;
  onEdit: (post: Post) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  threads: 'Threads',
};

function formatScheduledTime(raw: string | null | undefined): string {
  if (!raw) return 'Not set';
  const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00Z`);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function toLocalIsoDate(raw: string | null | undefined): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00Z`);
  return d.toISOString().slice(0, 10);
}

function toUTCTimeStr(raw: string | null | undefined): string {
  if (!raw || !raw.includes('T')) return '12:00';
  const d = new Date(raw);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Google Calendar-style event detail popup for a scheduled post.
 * Actions: Publish Now, Reschedule (inline date+time), Unschedule, Edit.
 */
export default function PostDetailModal({
  post,
  onClose,
  onPublishNow,
  onReschedule,
  onUnschedule,
  onEdit,
}: PostDetailModalProps) {
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [rescheduleDate, setRescheduleDate] = useState(
    toLocalIsoDate(post.scheduled_publish_at ?? post.scheduled_date)
  );
  const [rescheduleTime, setRescheduleTime] = useState(
    toUTCTimeStr(post.scheduled_publish_at)
  );
  const [publishing, setPublishing] = useState(false);
  const [unscheduling, setUnscheduling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = post.caption ?? post.script ?? post.hook ?? post.title ?? '';

  async function handlePublishNow() {
    setPublishing(true);
    setError(null);
    try {
      await onPublishNow(post);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnschedule() {
    setUnscheduling(true);
    setError(null);
    try {
      await onUnschedule(post.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unschedule failed');
    } finally {
      setUnscheduling(false);
    }
  }

  async function handleReschedule() {
    if (!rescheduleDate || !rescheduleTime) return;
    setRescheduling(true);
    setError(null);
    try {
      await onReschedule(post.id, rescheduleDate, rescheduleTime);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reschedule failed');
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-secondary border border-hair rounded-xl w-full max-w-md mx-4 flex flex-col shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-start justify-between p-4 border-b border-hair gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink3 mb-0.5">
              {PLATFORM_LABELS[post.platform] ?? post.platform}
            </p>
            <h3 className="font-serif text-[18px] font-normal tracking-[-0.025em] text-ink leading-snug line-clamp-2">
              {post.title}
            </h3>
          </div>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            <button
              onClick={() => onEdit(post)}
              title="Open in library"
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="p-4 space-y-3">

          {/* Metadata */}
          <div className="flex items-center gap-3 flex-wrap">
            <PillarDot pillar={post.pillar} showLabel />
            <StatusBadge status={post.status} />
          </div>

          {/* Scheduled time */}
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Calendar className="w-4 h-4 shrink-0 text-accent-primary" />
            <span>{formatScheduledTime(post.scheduled_publish_at ?? post.scheduled_date)}</span>
          </div>

          {/* Content preview */}
          {preview && (
            <div className="bg-bg-tertiary rounded-md p-3 text-[13px] text-text-primary leading-relaxed max-h-[100px] overflow-y-auto border border-border">
              {preview.slice(0, 280)}{preview.length > 280 ? '…' : ''}
            </div>
          )}

          {/* ── Reschedule inline form ── */}
          {mode === 'reschedule' && (
            <div className="border border-accent-primary/30 rounded-lg p-3 space-y-3 bg-bg-tertiary">
              <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink3">
                New date &amp; time (UTC)
              </p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="flex-1 bg-bg-secondary border border-border rounded-md px-2.5 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-primary transition-colors"
                />
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-28 bg-bg-secondary border border-border rounded-md px-2.5 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-primary transition-colors"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReschedule}
                  disabled={rescheduling}
                  className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-accent-primary text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {rescheduling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Update Schedule
                </button>
                <button
                  onClick={() => setMode('view')}
                  className="px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary border border-border rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-[12px] text-red-500 bg-red-50 dark:bg-red-950/20 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* ── Action footer ── */}
        {mode === 'view' && (
          <div className="p-4 border-t border-hair flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePublishNow}
              disabled={publishing || isPublished(post)}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-accent-primary text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {publishing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Publish Now
            </button>
            <button
              onClick={() => setMode('reschedule')}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium border border-border text-ink hover:border-border-hover rounded-md transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              Reschedule
            </button>
            <button
              onClick={handleUnschedule}
              disabled={unscheduling}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-red-500 border border-border hover:border-red-400/60 hover:bg-red-50/5 rounded-md transition-colors disabled:opacity-50 ml-auto"
            >
              {unscheduling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Unschedule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
