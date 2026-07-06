import Link from 'next/link';
import { Sunrise, TrendingUp, BarChart3, Lightbulb, ArrowRight } from 'lucide-react';
import type { MorningBrief } from '@/lib/rituals/morning-brief';
import { TrendDetectAction } from '@/components/dashboard/TrendDetectAction';

/**
 * Renders the daily morning brief: today's top trend, yesterday's numbers, and
 * ready-to-draft idea seeds. Presentational only — the brief is composed
 * server-side in the dashboard page from already-persisted data, so this card
 * adds no client fetch and no AI cost.
 */
export function MorningBriefCard({ brief }: { brief: MorningBrief }) {
  if (!brief.hasContent) return null;

  const { topTrend, yesterday, ideas } = brief;

  return (
    <div className="card-surface p-5">
      <div className="flex items-center gap-2">
        <Sunrise className="h-4 w-4 text-blue" />
        <span className="text-sm font-medium text-ink">Morning brief</span>
        <span className="ml-auto text-xs text-ink3">{brief.dateLabel}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
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

        {/* Ready-to-draft ideas */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink2">
            <Lightbulb className="h-3.5 w-3.5" />
            Ready to draft
          </div>
          {ideas.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {ideas.map((idea) => (
                <li key={idea.id}>
                  <Link
                    href={`/generate?tab=script&topic=${encodeURIComponent(idea.idea)}${idea.pillar ? `&pillar=${encodeURIComponent(idea.pillar)}` : ''}`}
                    className="text-xs text-ink2 hover:text-blue leading-snug line-clamp-2"
                  >
                    {idea.idea}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink3">Idea bank is empty.</p>
          )}
        </div>
      </div>
    </div>
  );
}
