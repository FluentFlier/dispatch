'use client';

import { TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from '@/components/analytics/RechartsWrapper';
import type { Post } from '@/lib/types';
import { postPillars } from '@/lib/pillars';
import { getPostDisplayTitle, hasPostMetrics, postEngagementScore } from '@/lib/analytics/post-metrics';
import PillarDot from '@/components/PillarDot';

function truncate(s: string, len: number) {
  return s.length > len ? s.slice(0, len) + '...' : s;
}

const CHART_TOOLTIP = {
  backgroundColor: '#FBFAF7',
  border: '1px solid rgba(23, 23, 23, 0.16)',
  color: '#171717',
  borderRadius: 8,
};

const CHART_COLORS = {
  coral: '#E8543A',
  yellow: '#D4A054',
  green: '#0F766E',
  blue: '#2563EB',
  grid: 'rgba(23, 23, 23, 0.08)',
  text: '#908D87',
};

interface ChartsSectionProps {
  posts: Post[];
  getLabel: (v: string) => string;
  getColor: (v: string) => string;
}

export default function ChartsSection({ posts, getLabel, getColor }: ChartsSectionProps) {
  const sorted = [...posts].sort(
    (a, b) => postEngagementScore(b) - postEngagementScore(a),
  );

  const engagementData = sorted.map((p) => ({
    name: truncate(getPostDisplayTitle(p), 20),
    engagement: postEngagementScore(p),
  }));

  const likesData = sorted.map((p) => ({
    name: truncate(getPostDisplayTitle(p), 20),
    likes: p.likes ?? 0,
  }));

  const commentsData = sorted.map((p) => ({
    name: truncate(getPostDisplayTitle(p), 20),
    comments: p.comments ?? 0,
  }));

  // LinkedIn often hides impressions — only chart views when we actually have them.
  const viewsData = sorted
    .filter((p) => (p.views ?? 0) > 0)
    .map((p) => ({
      name: truncate(getPostDisplayTitle(p), 20),
      views: p.views ?? 0,
    }));

  const savesData = sorted
    .filter((p) => (p.saves ?? 0) > 0)
    .map((p) => ({
      name: truncate(getPostDisplayTitle(p), 20),
      saves: p.saves ?? 0,
    }));

  // Prefer follows_gained; fall back to engagement over time so the timeline
  // isn't blank when LinkedIn doesn't attribute follower growth per post.
  const followsRaw = [...posts]
    .filter((p) => p.posted_date && (p.follows_gained ?? 0) > 0)
    .sort((a, b) => new Date(a.posted_date!).getTime() - new Date(b.posted_date!).getTime())
    .map((p) => ({
      date: new Date(p.posted_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      follows: p.follows_gained ?? 0,
    }));

  const engagementOverTime = [...posts]
    .filter((p) => p.posted_date && postEngagementScore(p) > 0)
    .sort((a, b) => new Date(a.posted_date!).getTime() - new Date(b.posted_date!).getTime())
    .map((p) => ({
      date: new Date(p.posted_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      engagement: postEngagementScore(p),
    }));

  const pillarMap: Record<string, { total: number; count: number }> = {};
  posts.forEach((p) => {
    const slugs = postPillars(p);
    const list = slugs.length > 0 ? slugs : ['uncategorized'];
    list.forEach((pillar) => {
      if (!pillarMap[pillar]) pillarMap[pillar] = { total: 0, count: 0 };
      pillarMap[pillar].total += postEngagementScore(p);
      pillarMap[pillar].count += 1;
    });
  });

  const topByEngagement = [...posts]
    .sort((a, b) => postEngagementScore(b) - postEngagementScore(a))
    .slice(0, 5);

  const chartHeight = Math.min(520, Math.max(280, sorted.length * 28));
  const hasAnyMetrics = posts.some(hasPostMetrics);

  return (
    <section className="bg-bg-secondary border border-border rounded-lg p-6 space-y-8">
      <h2 className="font-serif text-[24px] font-normal tracking-[-0.025em] text-ink flex items-center gap-2.5">
        <TrendingUp size={20} className="text-ink3" /> Performance Overview
      </h2>

      {posts.length === 0 ? (
        <p className="text-text-secondary text-sm">No posted posts yet. Publish content to see performance charts.</p>
      ) : !hasAnyMetrics ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-tertiary/40 px-4 py-8 text-center">
          <p className="text-sm font-medium text-text-primary">No performance data yet</p>
          <p className="mt-2 text-sm text-text-secondary max-w-md mx-auto">
            Click <strong>Sync stats from platforms</strong> above, or log LinkedIn impressions manually.
            Charts include every posted post once stats are available.
          </p>
        </div>
      ) : (
        <>
          {engagementData.some((d) => d.engagement > 0) && (
            <div>
              <h3 className="section-label mb-3">Engagement by post (likes + comments + shares)</h3>
              <div className="bg-bg-secondary border border-border rounded-lg p-4 overflow-x-auto">
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={engagementData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
                    />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Bar dataKey="engagement" fill={CHART_COLORS.blue} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {likesData.some((d) => d.likes > 0) && (
            <div>
              <h3 className="section-label mb-3">Likes by post</h3>
              <div className="bg-bg-secondary border border-border rounded-lg p-4 overflow-x-auto">
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={likesData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fill: CHART_COLORS.text, fontSize: 10 }} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Bar dataKey="likes" fill={CHART_COLORS.coral} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {commentsData.some((d) => d.comments > 0) && (
            <div>
              <h3 className="section-label mb-3">Comments by post</h3>
              <div className="bg-bg-secondary border border-border rounded-lg p-4 overflow-x-auto">
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={commentsData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fill: CHART_COLORS.text, fontSize: 10 }} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Bar dataKey="comments" fill={CHART_COLORS.green} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {viewsData.length > 0 && (
            <div>
              <h3 className="section-label mb-3">Views by post</h3>
              <div className="bg-bg-secondary border border-border rounded-lg p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={viewsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="name" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} angle={-30} textAnchor="end" height={80} />
                    <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Bar dataKey="views" fill={CHART_COLORS.coral} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {savesData.length > 0 && (
            <div>
              <h3 className="section-label mb-3">Saves by post</h3>
              <div className="bg-bg-secondary border border-border rounded-lg p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={savesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="name" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} angle={-30} textAnchor="end" height={80} />
                    <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Bar dataKey="saves" fill={CHART_COLORS.yellow} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {followsRaw.length > 0 ? (
            <div>
              <h3 className="section-label mb-3">Follows gained over time</h3>
              <div className="bg-bg-secondary border border-border rounded-lg p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={followsRaw}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="date" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} />
                    <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 11 }} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Line type="monotone" dataKey="follows" stroke={CHART_COLORS.green} strokeWidth={2} dot={{ fill: CHART_COLORS.green }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : engagementOverTime.length > 0 ? (
            <div>
              <h3 className="section-label mb-3">Engagement over time</h3>
              <div className="bg-bg-secondary border border-border rounded-lg p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={engagementOverTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="date" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} />
                    <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 11 }} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Line type="monotone" dataKey="engagement" stroke={CHART_COLORS.green} strokeWidth={2} dot={{ fill: CHART_COLORS.green }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          {Object.keys(pillarMap).length > 0 && (
            <div>
              <h3 className="section-label mb-3">Pillar breakdown</h3>
              <div className="bg-bg-secondary border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm min-w-[300px]">
                  <thead>
                    <tr className="border-b border-hair">
                      <th className="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium">Pillar</th>
                      <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium">Posts</th>
                      <th className="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 font-medium">Avg engagement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pillarMap).map(([pillar, { total, count }]) => (
                      <tr key={pillar} className="border-b border-hair/60">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getColor(pillar) }} />
                            <span className="text-ink">{getLabel(pillar)}</span>
                          </span>
                        </td>
                        <td className="text-right px-4 py-2.5 font-mono tabular-nums text-ink">{count}</td>
                        <td className="text-right px-4 py-2.5 font-mono tabular-nums text-ink">{Math.round(total / count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h3 className="section-label mb-3">Top performers</h3>
            <div className="space-y-2">
              {topByEngagement.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 bg-bg-tertiary border border-border rounded-lg px-4 py-3">
                  <span className="text-flame font-mono text-lg tabular-nums w-6">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-ink text-sm truncate">{getPostDisplayTitle(p)}</p>
                    <p className="font-mono text-[11px] tracking-[0.02em] text-ink3">
                      {postEngagementScore(p).toLocaleString()} engagement · {p.likes ?? 0} likes · {p.comments ?? 0} comments
                    </p>
                  </div>
                  <PillarDot pillar={p.pillar} showLabel />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
