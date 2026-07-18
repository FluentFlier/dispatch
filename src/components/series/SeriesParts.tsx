'use client';

import Link from 'next/link';
import { Plus, Pencil, ArrowUp, ArrowDown } from 'lucide-react';
import type { Post, Series } from '@/lib/types';
import type { Status } from '@/lib/constants';
import PillarDot from '@/components/PillarDot';
import { StageStepper } from './StageStepper';
import { PublishBar } from './PublishBar';
import { resolveSeriesStage, isPublishable, SERIES_STAGES } from '@/lib/series-stages';

interface SeriesPartsProps {
  series: Series;
  posts: Post[];
  loading: boolean;
  userId: string;
  busy: boolean;
  onSetStatus: (post: Post, status: Status) => void;
  onSwap: (a: Post, b: Post) => void;
  onAddPart: (position: number) => void;
  onChanged: () => void;
}

function buildSlots(series: Series, posts: Post[]): (Post | null)[] {
  const slots: (Post | null)[] = Array.from({ length: series.total_parts }, () => null);
  for (const post of posts) {
    const pos = post.series_position;
    if (pos !== null && pos >= 1 && pos <= series.total_parts) slots[pos - 1] = post;
  }
  return slots;
}

export default function SeriesParts({
  series,
  posts,
  loading,
  userId,
  busy,
  onSetStatus,
  onSwap,
  onAddPart,
  onChanged,
}: SeriesPartsProps) {
  if (loading) {
    return <div className="py-8 text-center text-sm text-ink3">Loading parts…</div>;
  }

  const slots = buildSlots(series, posts);

  return (
    <div className="space-y-3">
      {slots.map((post, idx) => {
        const position = idx + 1;

        if (!post) {
          return (
            <div
              key={`empty-${position}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-hair bg-white/40 px-4 py-4"
            >
              <span className="text-sm font-medium text-ink3">
                Part {position} · Not started
              </span>
              <button
                onClick={() => onAddPart(position)}
                className="btn-ghost min-h-[40px] px-3 text-sm text-blue hover:text-blue-dark"
              >
                <Plus className="h-4 w-4" />
                Add this part
              </button>
            </div>
          );
        }

        const stage = resolveSeriesStage(post);
        const prev = idx > 0 ? slots[idx - 1] : null;
        const next = idx < slots.length - 1 ? slots[idx + 1] : null;
        const stageLabel = SERIES_STAGES[stage].label;

        return (
          <div key={post.id} className="rounded-card border border-hair bg-white/70 p-4 md:p-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper2 text-sm font-semibold tabular-nums text-ink2">
                  {position}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-ink">{post.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-[13px] text-ink3">
                    <PillarDot pillar={post.pillar} />
                    <span>{stageLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => prev && onSwap(post, prev)}
                  disabled={!prev || busy}
                  className="rounded p-1.5 text-ink3 transition-colors hover:text-ink disabled:opacity-20"
                  title="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => next && onSwap(post, next)}
                  disabled={!next || busy}
                  className="rounded p-1.5 text-ink3 transition-colors hover:text-ink disabled:opacity-20"
                  title="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <Link
                  href={`/library?post=${post.id}`}
                  className="btn-ghost min-h-[36px] px-3 text-sm"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </div>
            </div>

            {/* Pipeline */}
            <div className="mt-4">
              <StageStepper
                currentIndex={stage}
                disabled={busy || post.status === 'posted'}
                onSetStatus={(status) => onSetStatus(post, status)}
              />
            </div>

            {/* Publish or a nudge to finish producing first */}
            <div className="mt-4">
              {isPublishable(post) ? (
                <PublishBar post={post} userId={userId} onChanged={onChanged} />
              ) : (
                <p className="rounded-card border border-dashed border-hair bg-paper2/40 px-4 py-3 text-[13px] text-ink3">
                  Write the script, then film and edit. Publishing opens up once this part has a
                  caption, hook, or script.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
