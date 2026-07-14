import Link from 'next/link';
import { Sunrise, TrendingUp, BarChart3, ArrowRight } from 'lucide-react';
import type { MorningBrief } from '@/lib/rituals/morning-brief';
import { TrendDetectAction } from '@/components/dashboard/TrendDetectAction';

/**
 * Top "signals" strip of the unified dashboard card: today's top trend +
 * yesterday's numbers. Presentational only - composed server-side, no client
 * fetch or AI cost. The old "Ready to draft" column was dropped: it showed the
 * same ideas as the card's Backlog lane, so it lived on there instead. Renders
 * with no card wrapper so it can nest inside the merged dashboard card.
 */
export function MorningBriefStrip({ brief }: { brief: MorningBrief }) {
  const { topTrend, yesterday } = brief;

  return (
    <>
      <div className="flex items-center gap-2">
        <Sunrise className="h-4 w-4 text-blue" />
        <span className="text-sm font-medium text-ink">Morning brief</span>
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

        {/* Yesterday's numbers */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink2">
            <BarChart3 className="h-3.5 w-3.5" />
            Yesterday
          </div>
          {yesterday ? (
            <div className="mt-2">
              <p className="text-sm text-ink">
                <span className="font-medium">{yesterday.postCount}</span> post
                {yesterday.postCount === 1 ? '' : 's'} ·{' '}
                <span className="font-medium">{yesterday.views.toLocaleString()}</span> views ·{' '}
                <span className="font-medium">{yesterday.saves.toLocaleString()}</span> saves
              </p>
              {yesterday.topPost && (
                <p className="mt-1 text-xs text-ink3 leading-snug line-clamp-2">
                  Top: {yesterday.topPost.title}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink3">Nothing posted yesterday.</p>
          )}
        </div>
      </div>
    </>
  );
}
