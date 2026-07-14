import Link from 'next/link';
import { Sunrise, TrendingUp, BarChart3, ArrowRight } from 'lucide-react';
import type { MorningBrief } from '@/lib/rituals/morning-brief';
import { TrendDetectAction } from '@/components/dashboard/TrendDetectAction';

/**
 * Top "signals" strip of the unified dashboard card: today's top trend +
 * yesterday's numbers. Presentational only — composed server-side, no client
 * fetch or AI cost. The old "Ready to draft" column was dropped: it showed the
 * same ideas as the card's Backlog lane, so it lived on there instead. Renders
 * with no card wrapper so it can nest inside the merged dashboard card.
 */
export function MorningBriefStrip({ brief }: { brief: MorningBrief }) {
  const { topTrend, latestPost } = brief;

  return (
    <>
      <div className="flex items-center gap-2.5">
        <Sunrise className="h-6 w-6 text-blue" />
        <h2 className="text-[clamp(22px,2.5vw,28px)] font-semibold tracking-[-0.03em] text-ink">Morning brief</h2>
        <span className="ml-auto text-xs text-ink3">{brief.dateLabel}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Today's top trend */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink2">
            <TrendingUp className="h-3.5 w-3.5" />
            Today&apos;s trend
          </div>
          {topTrend ? (
            <div className="mt-2">
              <p className="text-sm font-medium text-ink leading-snug">{topTrend.topic}</p>
              {topTrend.hook && (
                <p className="mt-1 text-xs text-ink3 leading-snug line-clamp-2">
                  &ldquo;{topTrend.hook}&rdquo;
                </p>
              )}
              <Link
                href="/generate?tab=trend"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue hover:underline"
              >
                Draft on this <ArrowRight className="h-3 w-3" />
              </Link>
              <TrendDetectAction hasTrend showWhenEmpty={false} />
            </div>
          ) : (
            <>
              <p className="mt-2 text-xs text-ink3">No trend detected yet.</p>
              <TrendDetectAction hasTrend={false} />
            </>
          )}
        </div>

        {/* Latest post analytics (falls back from yesterday to the most recent post) */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink2">
            <BarChart3 className="h-3.5 w-3.5" />
            {latestPost?.isYesterday ? 'Yesterday' : 'Latest post'}
          </div>
          {latestPost ? (
            <div className="mt-2">
              <p className="text-sm font-medium text-ink leading-snug line-clamp-1">{latestPost.title}</p>
              <p className="mt-1 text-xs text-ink3">
                <span className="font-medium text-ink2">{latestPost.views.toLocaleString()}</span> views ·{' '}
                <span className="font-medium text-ink2">{latestPost.saves.toLocaleString()}</span> saves
              </p>
              <Link
                href="/analytics"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue hover:underline"
              >
                Show more <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink3">No posts yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Standalone card wrapper. Main renamed this component to MorningBriefStrip for
 * nesting inside a merged dashboard card; this branch still renders it as its own
 * card, so keep the MorningBriefCard export as a thin card-surface wrapper.
 */
export function MorningBriefCard({ brief }: { brief: MorningBrief }) {
  return (
    <section className="card-surface p-5">
      <MorningBriefStrip brief={brief} />
    </section>
  );
}
