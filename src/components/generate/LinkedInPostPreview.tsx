'use client';

import { useState } from 'react';
import { ThumbsUp, MessageSquare, Repeat2, Send } from 'lucide-react';
import { getInitials, SEE_MORE_AT } from '@/lib/compose-preview';

interface LinkedInPostPreviewProps {
  name: string;
  headline?: string | null;
  text: string;
  imageUrl?: string | null;
  /** Timestamp label shown under the author (e.g. "Now", "2d"). */
  timeLabel?: string;
}

/**
 * Presentational LinkedIn feed-style post card. Shared by the composer (compose +
 * preview) and the Library drawer (LinkedIn post detail) so both render an
 * identical preview. Uses app theme colors, not LinkedIn's palette.
 */
export function LinkedInPostPreview({
  name,
  headline,
  text,
  imageUrl,
  timeLabel = 'Now',
}: LinkedInPostPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const initials = getInitials(name);
  const isLong = text.length > SEE_MORE_AT;
  const previewText = !expanded && isLong ? text.slice(0, SEE_MORE_AT) : text;

  return (
    <div className="rounded-lg border border-hair bg-paper p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-primary text-xs font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          {headline && <p className="truncate text-[12px] text-ink2">{headline}</p>}
          <p className="text-[11px] text-ink3">{timeLabel} · 🌐</p>
        </div>
      </div>
      <div className="mt-3 whitespace-pre-wrap font-body text-[14px] leading-[1.5] text-ink">
        {previewText}
        {isLong && !expanded && (
          <button onClick={() => setExpanded(true)} className="text-ink3 hover:text-ink"> ...more</button>
        )}
      </div>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Preview attachment" className="mt-3 max-h-80 w-full rounded-md object-cover" />
      )}
      <div className="mt-3 flex items-center justify-around border-t border-hair pt-2 text-[12px] text-ink2">
        <span className="flex items-center gap-1.5"><ThumbsUp className="h-4 w-4" /> Like</span>
        <span className="flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> Comment</span>
        <span className="flex items-center gap-1.5"><Repeat2 className="h-4 w-4" /> Repost</span>
        <span className="flex items-center gap-1.5"><Send className="h-4 w-4" /> Send</span>
      </div>
    </div>
  );
}
