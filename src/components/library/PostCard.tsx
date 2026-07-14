'use client';

import Image from 'next/image';
import type { Post } from '@/lib/types';
import { usePillars } from '@/hooks/usePillars';
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
  const { getColor } = usePillars();
  const borderColor = getColor(post.pillar);

  return (
    <div
      className="bg-bg-secondary border border-border rounded-lg cursor-pointer hover:border-border-hover transition-colors relative overflow-hidden"
      onClick={() => onClick(post)}
    >
      {/* Pillar left accent - 3px bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[2px]"
        style={{ backgroundColor: borderColor }}
      />

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
        </div>
      )}

      <div className="p-[13px_14px] pl-[18px]">

        {/* Title */}
        <h3 className="font-body font-[500] text-text-primary text-[13px] truncate pr-6 mb-2 leading-[1.3]">
          {post.title}
        </h3>

        {/* Badges */}
        <div className="flex items-center flex-wrap gap-[6px] mb-3">
          {/* Source platform chip — tells the user where the post came from */}
          <span className="inline-flex items-center rounded-[4px] border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-text-secondary">
            {PLATFORM_LABELS[post.platform] ?? post.platform}
          </span>
          {postPillars(post).map((p) => (
            <PillarBadge key={p} pillar={p} />
          ))}
          <StatusBadge status={post.status} />
        </div>

        {/* Script preview */}
        {post.script && (
          <p className="text-[13px] text-text-tertiary leading-[1.55] mb-3 line-clamp-2">
            {truncate(post.script, 120)}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-[11px] text-ink3">
          <span>{formatDateShort(post.scheduled_date)}</span>
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
