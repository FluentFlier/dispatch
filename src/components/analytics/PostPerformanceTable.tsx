'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import type { Post } from '@/lib/types';
import { PLATFORM_LABELS } from '@/lib/constants';
import { getPostDisplayTitle, hasPostMetrics } from '@/lib/analytics/post-metrics';
import PillarDot from '@/components/PillarDot';
import { formatDateShort } from '@/lib/utils';

const DEFAULT_VISIBLE = 10;

interface PostPerformanceTableProps {
  posts: Post[];
}

export default function PostPerformanceTable({ posts }: PostPerformanceTableProps) {
  const [showAll, setShowAll] = useState(true);

  const sorted = useMemo(
    () =>
      [...posts].sort((a, b) => {
        const aDate = a.posted_date ?? a.updated_at ?? '';
        const bDate = b.posted_date ?? b.updated_at ?? '';
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      }),
    [posts]
  );

  const visible = showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const withMetrics = sorted.filter(hasPostMetrics).length;

  return (
    <section className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[24px] font-normal tracking-[-0.025em] text-ink flex items-center gap-2.5">
            <BarChart3 size={20} className="text-ink3" /> All Posts
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            X and Instagram sync automatically after publish. LinkedIn may sync via Unipile or need manual logging below.
            {withMetrics > 0
              ? ` ${withMetrics} of ${sorted.length} posted ${sorted.length === 1 ? 'post has' : 'posts have'} stats.`
              : sorted.length > 0
                ? ' Stats will appear after you sync from platforms or log them above.'
                : ''}
          </p>
        </div>
        {sorted.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-accent-primary hover:underline"
          >
            {showAll ? (
              <>
                Show last {DEFAULT_VISIBLE}
                <ChevronUp size={14} />
              </>
            ) : (
              <>
                Show all {sorted.length} posts
                <ChevronDown size={14} />
              </>
            )}
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-text-secondary text-sm">
          No published posts yet. Once you publish, performance will show up here automatically.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-hair bg-bg-tertiary/50">
                <th className="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium">
                  Post
                </th>
                <th className="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium hidden sm:table-cell">
                  Platform
                </th>
                <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium">
                  Views
                </th>
                <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium">
                  Likes
                </th>
                <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium">
                  Saves
                </th>
                <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium hidden md:table-cell">
                  Comments
                </th>
                <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium hidden md:table-cell">
                  Shares
                </th>
                <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium hidden lg:table-cell">
                  Posted
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((post) => (
                <tr key={post.id} className="border-b border-hair/60 hover:bg-bg-tertiary/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/library?post=${post.id}`}
                      className="flex items-center gap-2 min-w-0 group"
                    >
                      <PillarDot pillar={post.pillar} />
                      <span className="text-ink text-sm truncate group-hover:text-accent-primary transition-colors">
                        {getPostDisplayTitle(post)}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink2 text-xs font-medium hidden sm:table-cell">
                    {PLATFORM_LABELS[post.platform] ?? post.platform}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono tabular-nums ${hasPostMetrics(post) ? 'text-ink' : 'text-ink3'}`}>
                    {(post.views ?? 0).toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono tabular-nums ${(post.likes ?? 0) > 0 ? 'text-ink' : 'text-ink3'}`}>
                    {(post.likes ?? 0).toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono tabular-nums ${(post.saves ?? 0) > 0 ? 'text-ink' : 'text-ink3'}`}>
                    {(post.saves ?? 0).toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono tabular-nums hidden md:table-cell ${(post.comments ?? 0) > 0 ? 'text-ink' : 'text-ink3'}`}>
                    {(post.comments ?? 0).toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono tabular-nums hidden md:table-cell ${(post.shares ?? 0) > 0 ? 'text-ink' : 'text-ink3'}`}>
                    {(post.shares ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] text-ink3 hidden lg:table-cell">
                    {formatDateShort(post.posted_date ?? post.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
