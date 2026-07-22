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
 * identical preview. LinkedIn previews intentionally use LinkedIn-like neutral
 * colors and spacing instead of the app theme so formatting can be checked
 * before publishing.
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
    <div className="overflow-hidden rounded-lg border border-[#e0dfdc] bg-white text-[#191919] shadow-sm">
      <div className="flex items-start gap-2 px-4 pt-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-xs font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-[#191919]">{name}</p>
          {headline && <p className="truncate text-xs text-[#666]">{headline}</p>}
          <p className="mt-0.5 text-xs text-[#666]">{timeLabel} · 🌐</p>
        </div>
      </div>
      <div className="whitespace-pre-wrap break-words px-4 pb-3 pt-2 font-[Arial,sans-serif] text-sm leading-5 text-[#191919]">
        {previewText}
        {isLong && !expanded && (
          <button onClick={() => setExpanded(true)} className="text-[#666] hover:text-[#191919]"> ...more</button>
        )}
      </div>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <div className="flex max-h-[420px] w-full items-center justify-center overflow-hidden bg-[#f3f2ef]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Preview attachment" className="block h-auto max-h-[420px] max-w-full object-contain" />
        </div>
      )}
      <div className="mx-4 flex items-center justify-around border-t border-[#e0dfdc] py-1 text-xs font-semibold text-[#666]">
        <span className="flex items-center gap-1.5 rounded px-2 py-2"><ThumbsUp className="h-5 w-5" /> Like</span>
        <span className="flex items-center gap-1.5 rounded px-2 py-2"><MessageSquare className="h-5 w-5" /> Comment</span>
        <span className="flex items-center gap-1.5 rounded px-2 py-2"><Repeat2 className="h-5 w-5" /> Repost</span>
        <span className="flex items-center gap-1.5 rounded px-2 py-2"><Send className="h-5 w-5" /> Send</span>
      </div>
    </div>
  );
}
