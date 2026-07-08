'use client';

import Link from 'next/link';
import { MessageSquare, ThumbsUp } from 'lucide-react';

/** Shape of the `engagement` block returned by GET /api/analytics. */
export interface AudienceEngagement {
  reactionBreakdown: Record<string, number>;
  totalReactions: number;
  totalComments: number;
  topCommenters: Array<{
    name: string;
    handle: string | null;
    headline: string | null;
    count: number;
  }>;
}

// LinkedIn's six reaction types, with display emoji.
const REACTION_META: Record<string, { emoji: string; label: string }> = {
  LIKE: { emoji: '👍', label: 'Like' },
  PRAISE: { emoji: '👏', label: 'Celebrate' },
  APPRECIATION: { emoji: '💖', label: 'Support' },
  EMPATHY: { emoji: '🤗', label: 'Love' },
  INTEREST: { emoji: '💡', label: 'Insightful' },
  ENTERTAINMENT: { emoji: '😄', label: 'Funny' },
};

/**
 * Audience section for the analytics page: reaction-type distribution and top
 * commenters from synced engagement. Renders nothing until the first
 * engagement sync lands data, so empty accounts don't see a dead panel.
 */
export default function AudienceSection({
  engagement,
}: {
  engagement: AudienceEngagement | null;
}) {
  if (!engagement || (engagement.totalReactions === 0 && engagement.totalComments === 0)) {
    return (
      <div className="rounded-xl border border-border bg-bg-secondary p-6 text-sm text-text-secondary">
        <p>Reaction and commenter analytics appear after you publish and sync engagement.</p>
        <Link href="/inbox" className="mt-2 inline-block text-accent-primary hover:underline">
          Open Inbox to sync comments →
        </Link>
      </div>
    );
  }

  const reactions = Object.entries(engagement.reactionBreakdown).sort((a, b) => b[1] - a[1]);
  const maxReaction = reactions.length > 0 ? reactions[0][1] : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Reaction breakdown */}
      <div className="rounded-xl border border-border bg-bg-secondary p-6">
        <div className="mb-4 flex items-center gap-2">
          <ThumbsUp className="h-5 w-5 text-coral" />
          <h3 className="font-semibold">Reaction Breakdown</h3>
          <span className="ml-auto font-mono text-xs text-text-tertiary">
            {engagement.totalReactions} total
          </span>
        </div>
        {reactions.length === 0 ? (
          <p className="text-sm text-text-tertiary">No reactions synced yet.</p>
        ) : (
          <div className="space-y-2">
            {reactions.map(([type, count]) => {
              const meta = REACTION_META[type] ?? { emoji: '✨', label: type };
              return (
                <div key={type} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm">
                    {meta.emoji} {meta.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-bg">
                    <div
                      className="h-full rounded bg-coral/70"
                      style={{ width: `${maxReaction ? (count / maxReaction) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top commenters */}
      <div className="rounded-xl border border-border bg-bg-secondary p-6">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-sage" />
          <h3 className="font-semibold">Top Commenters</h3>
          <span className="ml-auto font-mono text-xs text-text-tertiary">
            {engagement.totalComments} comments
          </span>
        </div>
        {engagement.topCommenters.length === 0 ? (
          <p className="text-sm text-text-tertiary">No comments synced yet.</p>
        ) : (
          <ul className="space-y-3">
            {engagement.topCommenters.map((c, i) => (
              <li key={`${c.handle ?? c.name}-${i}`} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg font-mono text-xs text-text-tertiary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  {c.headline && (
                    <div className="truncate text-xs text-text-tertiary">{c.headline}</div>
                  )}
                </div>
                <span className="shrink-0 rounded bg-sage/10 px-2 py-0.5 font-mono text-xs text-sage">
                  {c.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
