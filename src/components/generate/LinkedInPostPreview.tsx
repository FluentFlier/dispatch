'use client';

import { useState } from 'react';
import { ThumbsUp, MessageSquare, Repeat2, Send, Globe2, MoreHorizontal } from 'lucide-react';
import { getInitials, SEE_MORE_AT } from '@/lib/compose-preview';

interface LinkedInPostPreviewProps {
  name: string;
  headline?: string | null;
  text: string;
  imageUrl?: string | null;
  /** Timestamp label shown under the author (e.g. "Now", "2d"). */
  timeLabel?: string;
  /** Real engagement, when the post has already gone live. */
  reactions?: number;
  comments?: number;
  reposts?: number;
}

const ACTIONS = [
  { label: 'Like', Icon: ThumbsUp },
  { label: 'Comment', Icon: MessageSquare },
  { label: 'Repost', Icon: Repeat2 },
  { label: 'Send', Icon: Send },
] as const;

/**
 * Presentational LinkedIn feed-style post card. Shared by the composer (compose +
 * preview) and the Library drawer (LinkedIn post detail) so both render an
 * identical preview.
 *
 * Laid out to match the real feed card, because the whole point of a preview is
 * predicting what the post will look like once it is live: 48px avatar,
 * headline clamped to two lines, body collapsed behind "…more" at LinkedIn's
 * own threshold, image bled to the card edges, then the social-proof line and
 * the action bar. Uses app theme colors rather than LinkedIn's palette.
 */
export function LinkedInPostPreview({
  name,
  headline,
  text,
  imageUrl,
  timeLabel = 'Now',
  reactions = 0,
  comments = 0,
  reposts = 0,
}: LinkedInPostPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const initials = getInitials(name);
  const isLong = text.length > SEE_MORE_AT;
  const previewText = !expanded && isLong ? text.slice(0, SEE_MORE_AT) : text;
  const hasProof = reactions > 0 || comments > 0 || reposts > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-hair bg-paper shadow-sm">
      {/* Author */}
      <div className="flex items-start gap-2 px-3 pt-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-primary text-[13px] font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-ink">
            {name}
            <span className="ml-1 font-normal text-ink3">· You</span>
          </p>
          {headline && <p className="line-clamp-2 text-[12px] text-ink2">{headline}</p>}
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink3">
            {timeLabel} ·
            <Globe2 className="h-3 w-3" aria-label="Visible to anyone" />
          </p>
        </div>
        <MoreHorizontal className="h-5 w-5 shrink-0 text-ink3" aria-hidden />
      </div>

      {/* Body */}
      <div className="whitespace-pre-wrap px-3 pb-3 pt-2 font-body text-[14px] leading-[1.43] text-ink">
        {previewText}
        {isLong && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="cursor-pointer text-ink3 transition-colors hover:text-blue"
          >
            …more
          </button>
        )}
      </div>

      {/* Attachment - full-bleed, the way the feed renders it */}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Preview attachment" className="max-h-96 w-full object-cover" />
      )}

      {/* Social proof */}
      {hasProof && (
        <div className="flex items-center justify-between px-3 py-2 text-[12px] text-ink3">
          <span className="flex items-center gap-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue text-white">
              <ThumbsUp className="h-2.5 w-2.5" />
            </span>
            {reactions > 0 && reactions}
          </span>
          <span>
            {comments > 0 && `${comments} comment${comments === 1 ? '' : 's'}`}
            {comments > 0 && reposts > 0 && ' · '}
            {reposts > 0 && `${reposts} repost${reposts === 1 ? '' : 's'}`}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className={`flex items-center justify-around border-t border-hair px-2 py-1 ${hasProof ? '' : 'mt-1'}`}>
        {ACTIONS.map(({ label, Icon }) => (
          <span
            key={label}
            className="flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-2 text-[13px] font-medium text-ink2"
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
