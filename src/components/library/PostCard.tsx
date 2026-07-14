'use client';

import Image from 'next/image';
import type { Post } from '@/lib/types';
import StatusBadge from '@/components/ui/StatusBadge';
import PillarBadge from '@/components/ui/PillarBadge';
import { postPillars } from '@/lib/pillars';
import { PLATFORM_LABELS } from '@/lib/constants';
import { formatDateShort, truncate } from '@/lib/utils';

interface PostCardProps {
  post: Post;
  selected: boolean;
  onSelect: (id: string) => void;
  onClick: (post: Post) => void;
}

export default function PostCard({ post, selected, onSelect, onClick }: PostCardProps) {
  const platformLabel = post.platform
    ? PLATFORM_LABELS[post.platform as keyof typeof PLATFORM_LABELS] ?? post.platform
    : '';
  // The 'general' fallback pillar isn't a real pillar — never show it as a tag.
  const realPillars = postPillars(post).filter((p) => p !== 'general');
  const dateStr = post.scheduled_date ?? post.posted_date ?? null;

  return (
    <div
      className="bg-bg-secondary border border-border rounded-lg cursor-pointer hover:border-border-hover transition-colors relative overflow-hidden"
      onClick={() => onClick(post)}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => {
          e.stopPropagation();
          onSelect(post.id);
        }}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-3 right-3 z-10 w-4 h-4 accent-accent-primary"
      />

      {post.image_url && (
        <div className="relative h-32 w-full overflow-hidden border-b border-border bg-bg-tertiary">
          <Image
            src={post.image_url}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
            unoptimized
          />
          {/* Airbnb-style platform badge overlaid on the media */}
          {post.platform && (
            <span className="absolute left-2.5 top-2.5 z-10 inline-flex items-center rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-ink shadow-sm">
              {platformLabel}
            </span>
          )}
        </div>
      )}

      <div className="p-[13px_14px] pl-[18px]">

        {/* Platform badge for text-only posts (no media to overlay) */}
        {!post.image_url && post.platform && (
          <span className="mb-2 inline-flex items-center rounded-full border border-hair bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-ink shadow-sm">
            {platformLabel}
          </span>
        )}

        {/* Title */}
        <h3 className="font-body font-[500] text-text-primary text-[13px] truncate pr-6 mb-2 leading-[1.3]">
          {post.title}
        </h3>

        {/* Real pillars only — the 'general' fallback is hidden */}
        {realPillars.length > 0 && (
          <div className="flex items-center flex-wrap gap-[6px] mb-3">
            {realPillars.map((p) => (
              <PillarBadge key={p} pillar={p} />
            ))}
          </div>
        )}

        {/* Script preview */}
        {post.script && (
          <p className="text-[13px] text-text-tertiary leading-[1.55] mb-3 line-clamp-2">
            {truncate(post.script, 120)}
          </p>
        )}

        {/* Footer: status bottom-left, metrics right */}
        <div className="flex items-center justify-between text-[11px] text-ink3">
          <div className="flex items-center gap-2">
            <StatusBadge status={post.status} />
            {dateStr && <span>{formatDateShort(dateStr)}</span>}
          </div>
          {post.status === 'posted' && (post.views !== null || post.saves !== null) && (
            <span className="flex gap-2">
              {post.views !== null && <span>{post.views} views</span>}
              {post.saves !== null && <span>{post.saves} saves</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
