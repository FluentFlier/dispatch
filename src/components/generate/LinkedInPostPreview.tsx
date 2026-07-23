'use client';

import { useState } from 'react';
import { ThumbsUp, MessageSquare, Repeat2, Send, Globe2, MoreHorizontal } from 'lucide-react';
import { getInitials, SEE_MORE_AT } from '@/lib/compose-preview';

interface LinkedInPostPreviewProps {
  name: string;
  headline?: string | null;
  text: string;
  imageUrl?: string | null;
  /** Every image on the post. Falls back to imageUrl when not supplied. */
  imageUrls?: string[];
  /** Video attachment, for a post whose media is a video rather than photos. */
  videoUrl?: string | null;
  /** Timestamp label shown under the author (e.g. "Now", "2d"). */
  timeLabel?: string;
  /** Real engagement, when the post has already gone live. */
  reactions?: number;
  comments?: number;
  reposts?: number;
  /** Top comments, shown under the action bar the way the feed shows them. */
  topComments?: Array<{
    id: string;
    author: string;
    headline?: string | null;
    text: string;
    age?: string | null;
  }>;
  /** Total comment count, for the "View all N comments" line. */
  totalComments?: number;
  /** The post being reshared, for a repost. Rendered as a quoted card. */
  repost?: {
    text?: string;
    author?: { name?: string; public_identifier?: string } | null;
    date?: string;
    images?: string[];
  } | null;
}

/**
 * A post's media, laid out the way the LinkedIn feed lays it out: a video plays
 * on its own, one photo is letterboxed on LinkedIn's grey and shown whole (no
 * cropping - the preview must show exactly what will publish), two split the
 * row, three put a tall one beside a stacked pair, and four or more become a
 * 2x2 with the overflow counted on the last tile. Rendering only the first
 * photo made a carousel look like a single-image post.
 */
function PostMedia({ images, videoUrl }: { images: string[]; videoUrl?: string | null }) {
  if (videoUrl) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={videoUrl} controls preload="metadata" className="max-h-96 w-full bg-black object-contain" />
    );
  }
  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <div className="flex max-h-[420px] w-full items-center justify-center overflow-hidden bg-[#f3f2ef]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[0]} alt="Post attachment" className="block h-auto max-h-[420px] max-w-full object-contain" />
      </div>
    );
  }

  const tiles = images.slice(0, 4);
  const overflow = images.length - tiles.length;
  const layout =
    tiles.length === 2
      ? 'grid-cols-2 grid-rows-1'
      : tiles.length === 3
        ? 'grid-cols-2 grid-rows-2'
        : 'grid-cols-2 grid-rows-2';

  return (
    <div className={`grid ${layout} h-72 gap-0.5`}>
      {tiles.map((url, i) => (
        <div
          key={url}
          className={`relative overflow-hidden ${tiles.length === 3 && i === 0 ? 'row-span-2' : ''}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`Post attachment ${i + 1}`} className="h-full w-full object-cover" />
          {overflow > 0 && i === tiles.length - 1 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[20px] font-semibold text-white">
              +{overflow}
            </div>
          )}
        </div>
      ))}
    </div>
  );
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
 * the action bar. Intentionally uses LinkedIn-like neutral colors, spacing, and
 * Arial - NOT the app theme - so formatting can be checked against exactly what
 * the feed will render before publishing.
 */
export function LinkedInPostPreview({
  name,
  headline,
  text,
  imageUrl,
  imageUrls,
  videoUrl,
  timeLabel = 'Now',
  reactions = 0,
  comments = 0,
  reposts = 0,
  repost = null,
  topComments,
  totalComments = 0,
}: LinkedInPostPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const initials = getInitials(name);
  const isLong = text.length > SEE_MORE_AT;
  const previewText = !expanded && isLong ? text.slice(0, SEE_MORE_AT) : text;
  const hasProof = reactions > 0 || comments > 0 || reposts > 0;
  // imageUrls is the full set; imageUrl is the single-image callers (composer)
  // and the legacy first-image-only shape.
  const images = imageUrls?.length ? imageUrls : imageUrl ? [imageUrl] : [];

  return (
    <div className="overflow-hidden rounded-lg border border-[#e0dfdc] bg-white text-[#191919] shadow-sm">
      {/* Author */}
      <div className="flex items-start gap-2 px-4 pt-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-[13px] font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-[#191919]">
            {name}
            <span className="ml-1 font-normal text-[#666]">· You</span>
          </p>
          {headline && <p className="line-clamp-2 text-xs text-[#666]">{headline}</p>}
          <p className="mt-0.5 flex items-center gap-1 text-xs text-[#666]">
            {timeLabel} ·
            <Globe2 className="h-3 w-3" aria-label="Visible to anyone" />
          </p>
        </div>
        <MoreHorizontal className="h-5 w-5 shrink-0 text-[#666]" aria-hidden />
      </div>

      {/* Body */}
      <div className="whitespace-pre-wrap break-words px-4 pb-3 pt-2 font-[Arial,sans-serif] text-sm leading-5 text-[#191919]">
        {previewText}
        {isLong && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="cursor-pointer text-[#666] transition-colors hover:text-[#0a66c2]"
          >
            …more
          </button>
        )}
      </div>

      {/* The reshared post, quoted inside the card the way LinkedIn nests it. */}
      {repost && (repost.text || repost.author?.name) && (
        <div className="mx-4 mb-3 overflow-hidden rounded-lg border border-[#e0dfdc]">
          <div className="flex items-center gap-2 px-3 pt-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f2ef] text-[12px] font-semibold text-[#666]">
              {getInitials(repost.author?.name ?? '?')}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold text-[#191919]">
                {repost.author?.name ?? 'Someone'}
              </p>
              {repost.date && <p className="text-[11px] text-[#666]">{repost.date}</p>}
            </div>
          </div>
          {repost.text && (
            <p className="line-clamp-6 whitespace-pre-wrap px-3 pb-2 pt-2 font-[Arial,sans-serif] text-[13px] leading-[1.43] text-[#444]">
              {repost.text}
            </p>
          )}
          {repost.images && repost.images.length > 0 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={repost.images[0]} alt="" className="max-h-72 w-full object-cover" />
          )}
        </div>
      )}

      {/* Attachments - full-bleed, the way the feed renders them */}
      <PostMedia images={images} videoUrl={videoUrl} />

      {/* Social proof */}
      {hasProof && (
        <div className="flex items-center justify-between px-4 py-2 text-xs text-[#666]">
          <span className="flex items-center gap-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0a66c2] text-white">
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
      <div className={`mx-4 flex items-center justify-around border-t border-[#e0dfdc] py-1 ${hasProof ? '' : 'mt-1'}`}>
        {ACTIONS.map(({ label, Icon }) => (
          <span
            key={label}
            className="flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-2 text-xs font-semibold text-[#666]"
          >
            <Icon className="h-5 w-5" />
            {label}
          </span>
        ))}
      </div>

      {/* Top comments, the way the feed hangs them under the card. */}
      {topComments && topComments.length > 0 && (
        <div className="space-y-3 border-t border-[#e0dfdc] px-4 py-3">
          {topComments.map((c) => (
            <div key={c.id} className="flex gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f2ef] text-[11px] font-semibold text-[#666]">
                {getInitials(c.author)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[13px] font-semibold text-[#191919]">{c.author}</p>
                  {c.age && <span className="shrink-0 text-xs text-[#666]">{c.age}</span>}
                </div>
                {c.headline && <p className="line-clamp-1 text-xs text-[#666]">{c.headline}</p>}
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap font-[Arial,sans-serif] text-[13px] leading-[1.43] text-[#191919]">
                  {c.text}
                </p>
              </div>
            </div>
          ))}
          {totalComments > topComments.length && (
            <p className="text-[13px] font-semibold text-[#666]">
              View all {totalComments} comments
            </p>
          )}
        </div>
      )}
    </div>
  );
}
