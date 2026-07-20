'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Send, CalendarDays, Check } from 'lucide-react';
import { getInsforge } from '@/lib/insforge/client';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useToast } from '@/components/ui/Toast';
import { DASHBOARD_PLATFORMS, PLATFORM_LABELS, type DashboardPlatform } from '@/lib/constants';
import type { Post } from '@/lib/types';
import { isPublished } from '@/lib/posts/published';

interface PublishBarProps {
  post: Post;
  userId: string;
  onChanged: () => void;
}

function toPublishText(post: Post): string {
  return post.caption ?? post.script ?? post.hook ?? post.title ?? '';
}

/** Default the quick-schedule date to tomorrow at 9am local. */
function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The final step of a part's journey: choose platform, then publish now,
 * quick-schedule inline, or hand off to the calendar to fine-tune. Posting is
 * deliberately last - everything above this is production.
 */
export function PublishBar({ post, userId, onChanged }: PublishBarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [platform, setPlatform] = useState<DashboardPlatform>(
    DASHBOARD_PLATFORMS.includes(post.platform as DashboardPlatform)
      ? (post.platform as DashboardPlatform)
      : 'linkedin',
  );
  const [date, setDate] = useState(post.scheduled_date?.slice(0, 10) ?? defaultDate());
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState<'publish' | 'schedule' | null>(null);

  const posted = isPublished(post);
  const scheduled = Boolean(post.scheduled_date);

  async function changePlatform(next: DashboardPlatform) {
    const prev = platform;
    setPlatform(next);
    if (next === post.platform) return;
    try {
      await getInsforge().database
        .from('posts')
        .update({ platform: next, updated_at: new Date().toISOString() })
        .eq('id', post.id)
        .eq('user_id', userId);
      onChanged();
    } catch {
      setPlatform(prev); // keep local selection in sync with the DB write
      toast('Could not change platform', 'error');
    }
  }

  async function publishNow() {
    setBusy('publish');
    try {
      const res = await fetchWithAuth('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: post.id,
          platform,
          content: toPublishText(post),
          imageUrl: post.image_url ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(
          res.status === 402 || res.status === 403
            ? 'Publishing requires a paid plan.'
            : (data as { error?: string }).error ?? 'Publish failed',
          'error',
        );
        return;
      }
      toast(`Published to ${PLATFORM_LABELS[platform]}`);
      onChanged();
    } catch {
      toast('Publish failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function schedule() {
    setBusy('schedule');
    try {
      const [h, m] = time.split(':').map(Number);
      const [y, mo, d] = date.split('-').map(Number);
      const at = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
      await getInsforge().database
        .from('posts')
        .update({
          scheduled_date: date,
          scheduled_publish_at: at.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id)
        .eq('user_id', userId);
      toast('Scheduled');
      onChanged();
    } catch {
      toast('Could not schedule', 'error');
    } finally {
      setBusy(null);
    }
  }

  if (posted) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-hair bg-paper2/60 px-4 py-3 text-sm text-ink2">
        <Check className="h-4 w-4 text-teal" />
        Published to {PLATFORM_LABELS[platform]}
        {post.posted_date && <span className="text-ink3">· {post.posted_date}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-card border border-hair bg-paper2/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="section-label">Publish to</span>
          <div className="flex items-center gap-1 rounded-full border border-hair bg-white/70 p-0.5">
            {DASHBOARD_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => changePlatform(p)}
                className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
                  platform === p ? 'bg-ink text-paper' : 'text-ink3 hover:text-ink'
                }`}
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        {scheduled && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink2">
            <CalendarDays className="h-4 w-4 text-blue" />
            Scheduled for {post.scheduled_date}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-ink3">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-[40px] rounded-control border border-hair bg-white px-3 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink3">
          Time
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="min-h-[40px] rounded-control border border-hair bg-white px-3 text-sm text-ink"
          />
        </label>
        <button
          type="button"
          onClick={schedule}
          disabled={busy !== null}
          className="btn-secondary min-h-[40px] px-4 text-sm disabled:opacity-50"
        >
          <CalendarPlus className="h-4 w-4" />
          {busy === 'schedule' ? 'Scheduling…' : scheduled ? 'Reschedule' : 'Schedule'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/calendar')}
          className="btn-ghost min-h-[40px] px-3 text-sm"
        >
          <CalendarDays className="h-4 w-4" />
          Open calendar
        </button>
        <button
          type="button"
          onClick={publishNow}
          disabled={busy !== null}
          className="btn-primary min-h-[40px] px-5 text-sm disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {busy === 'publish' ? 'Publishing…' : 'Publish now'}
        </button>
      </div>
    </div>
  );
}
