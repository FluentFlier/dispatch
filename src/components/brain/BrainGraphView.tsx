'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Brain, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BrainGraph, BrainGraphNode, BrainNodeKind } from '@/lib/brain/graph';
import type { BrainDecision, BrainInsightsSummary } from '@/lib/brain/insights';
import type { ContentLearning, LearningSentiment } from '@/lib/brain/learnings';
import { BrainGraphCanvas, KIND_LABELS } from './BrainGraphCanvas';

interface GraphResponse extends BrainGraph {
  provisioned: boolean;
  page_count: number;
  last_updated: string | null;
  insights?: BrainInsightsSummary;
  learnings?: ContentLearning[];
  pipeline_learnings?: ContentLearning[];
  migration_required?: boolean;
  error?: string;
}

const LEARNING_STYLE: Record<LearningSentiment, { badge: string; accent: string }> = {
  positive: { badge: 'border-lime/30 bg-lime/15 text-ink', accent: 'border-lime/25' },
  watch: { badge: 'border-coral/30 bg-coral/10 text-ink', accent: 'border-coral/25' },
  neutral: { badge: 'border-hair bg-paper2 text-ink2', accent: 'border-hair' },
};

const LEGEND_ORDER: BrainNodeKind[] = [
  'core',
  'pillar',
  'post',
  'performance',
  'story',
  'gtm',
  'references',
];

const LEGEND_COLOR: Record<BrainNodeKind, string> = {
  core: '#2563EB',
  performance: '#0F766E',
  gtm: '#E8543A',
  references: '#8B7BB8',
  pillar: '#171717',
  post: '#5B8FA8',
  story: '#E07A5F',
};

const PRIORITY_STYLE: Record<BrainDecision['priority'], string> = {
  high: 'border-coral/25 bg-coral/8',
  medium: 'border-hair bg-paper2/60',
  low: 'border-hair bg-white/70',
};

export function BrainGraphView() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<BrainGraphNode | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ id: string; nodeIds: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brain/graph');
      const json = (await res.json()) as GraphResponse;
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSync = useCallback(
    async (endpoint: string) => {
      setSyncing(true);
      setMessage('');
      try {
        const res = await fetch(endpoint, { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed');
        const parts = [
          json.synced_posts != null ? `${json.synced_posts} posts` : null,
          json.synced_stories != null ? `${json.synced_stories} stories` : null,
        ].filter(Boolean);
        setMessage(`Synced ${parts.join(' and ')} into memory`);
        await load();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Sync failed');
      } finally {
        setSyncing(false);
      }
    },
    [load],
  );

  const graph = useMemo<BrainGraph>(
    () => ({ nodes: data?.nodes ?? [], edges: data?.edges ?? [] }),
    [data],
  );

  const insights = data?.insights;
  const learnings = data?.learnings ?? [];
  const pipelineLearnings = data?.pipeline_learnings ?? [];

  const handleLearningClick = useCallback((learning: ContentLearning) => {
    setSelected(null);
    setFocusId(null);
    setHighlight((cur) => {
      if (learning.nodeIds.length === 0) return null; // nothing to trace (e.g. a content gap)
      return cur?.id === learning.id ? null : { id: learning.id, nodeIds: learning.nodeIds };
    });
  }, []);

  const counts = useMemo(() => {
    const map = new Map<BrainNodeKind, number>();
    for (const n of graph.nodes) map.set(n.kind, (map.get(n.kind) ?? 0) + 1);
    return map;
  }, [graph.nodes]);

  const handleDecisionClick = useCallback(
    (decision: BrainDecision) => {
      if (decision.nodeId) {
        const node = graph.nodes.find((n) => n.id === decision.nodeId) ?? null;
        setSelected(node);
        setFocusId(decision.nodeId);
        setHighlight(null);
      }
    },
    [graph.nodes],
  );

  if (loading) {
    return <div className="h-[560px] animate-pulse rounded-surface border border-hair bg-white/60" />;
  }

  if (data?.migration_required) {
    return (
      <div className="rounded-surface border border-amber-200/80 bg-amber-50/80 p-6">
        <div className="flex items-center gap-2 text-amber-800">
          <Brain className="h-4 w-4" />
          <span className="text-sm font-medium">Creator Brain not enabled</span>
        </div>
        <p className="mt-2 text-sm text-ink3">
          Apply <code className="text-ink2">db/creator-brain.sql</code> on InsForge to enable memory pages, then refresh.
        </p>
      </div>
    );
  }

  if (!data?.provisioned || graph.nodes.length <= 1) {
    return (
      <div className="flex flex-col items-center justify-center rounded-surface border border-dashed border-hair bg-white/60 py-20 text-center">
        <Brain className="mb-4 h-10 w-10 text-blue" />
        <h2 className="text-[20px] font-normal tracking-[-0.02em] text-ink">Your brain is empty</h2>
        <p className="mt-1 max-w-sm text-[13px] text-ink3">
          Set up your Creator Brain to map how your voice, pillars, and top posts connect.
        </p>
        {message && <p className="mt-3 text-xs text-blue">{message}</p>}
        <Button
          size="sm"
          variant="secondary"
          className="mt-4"
          loading={syncing}
          onClick={() => runSync('/api/brain/provision')}
        >
          Set up Creator Brain
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Coverage + legend row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {insights && (
            <CoverageBadge coverage={insights.coverage} />
          )}
          {LEGEND_ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5 text-[12px] text-ink2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LEGEND_COLOR[kind] }} />
              {KIND_LABELS[kind]}
              <span className="text-ink3">{counts.get(kind)}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {message && <span className="text-xs text-blue">{message}</span>}
          <Button
            size="sm"
            variant="secondary"
            loading={syncing}
            onClick={() => runSync('/api/brain/sync')}
            title="Refresh memory from profile, posts, and stories"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        </div>
      </div>

      {/* Learning summary */}
      {insights && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InsightCard label="Posts in memory" value={String(insights.postCount)} />
          <InsightCard label="Story memories" value={String(insights.storyCount)} />
          <InsightCard
            label="Top pillar"
            value={insights.topPillarByPerformance?.label ?? '-'}
            hint={
              insights.topPillarByPerformance?.views
                ? `${insights.topPillarByPerformance.views.toLocaleString()} views`
                : undefined
            }
          />
          <InsightCard
            label="Best performer"
            value={insights.bestPost?.label ?? '-'}
            hint={
              insights.bestPost?.views
                ? `${insights.bestPost.views.toLocaleString()} views`
                : undefined
            }
          />
        </div>
      )}

      {/* What's working - mined content-performance learnings */}
      <LearningSection
        title="What's working"
        subtitle="Learned from your published performance. Click a learning to trace it on the graph."
        learnings={learnings}
        activeId={highlight?.id ?? null}
        onPick={handleLearningClick}
        onClear={() => setHighlight(null)}
      />

      {/* From your pipeline - content ↔ lead fit */}
      <LearningSection
        title="From your pipeline"
        subtitle="How your content lines up with the themes and intent of your actual leads."
        learnings={pipelineLearnings}
        activeId={highlight?.id ?? null}
        onPick={handleLearningClick}
        onClear={() => setHighlight(null)}
      />

      {/* Setup nudges - shown only when there isn't enough data for real learnings */}
      {insights && learnings.length === 0 && pipelineLearnings.length === 0 && insights.decisions.length > 0 && (
        <section className="card-surface p-4">
          <h2 className="text-[13px] font-semibold tracking-[0.01em] text-ink">What to do next</h2>
          <p className="mt-0.5 text-[12px] text-ink3">
            Based on what your brain has learned - and what&apos;s still missing.
          </p>
          <ul className="mt-3 space-y-2">
            {insights.decisions.map((decision) => (
              <li key={decision.id}>
                <div
                  className={`flex flex-wrap items-start justify-between gap-3 rounded-card border p-3 ${PRIORITY_STYLE[decision.priority]}`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => handleDecisionClick(decision)}
                  >
                    <p className="text-[13px] font-semibold text-ink">{decision.title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink2">{decision.detail}</p>
                  </button>
                  {decision.action && (
                    <Link
                      href={decision.action.href}
                      className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-blue hover:underline"
                    >
                      {decision.action.label}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="relative">
        <div className="h-[560px] w-full">
          <BrainGraphCanvas
            graph={graph}
            selectedId={selected?.id ?? null}
            focusId={focusId}
            highlightIds={highlight?.nodeIds}
            onSelect={(node) => {
              setSelected(node);
              setFocusId(node?.id ?? null);
              setHighlight(null);
            }}
          />
        </div>

        {selected && (
          <aside className="absolute right-3 top-3 w-72 rounded-surface border border-hair bg-white/95 p-4 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="section-label">{KIND_LABELS[selected.kind]}</span>
                <h3 className="mt-1 text-[15px] font-semibold leading-tight text-ink">{selected.label}</h3>
                {selected.pending && (
                  <p className="mt-1 text-[11px] text-ink3">Not populated yet</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setFocusId(null);
                }}
                className="shrink-0 rounded-md p-1 text-ink3 transition-colors hover:bg-paper2 hover:text-ink"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {selected.detail && <p className="mt-2 text-[13px] leading-relaxed text-ink2">{selected.detail}</p>}
            {selected.meta && Object.keys(selected.meta).length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-hair pt-3">
                {Object.entries(selected.meta).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-[10px] tracking-[0.01em] text-ink3">{key}</dt>
                    <dd className="text-[13px] font-medium text-ink tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function LearningSection({
  title,
  subtitle,
  learnings,
  activeId,
  onPick,
  onClear,
}: {
  title: string;
  subtitle: string;
  learnings: ContentLearning[];
  activeId: string | null;
  onPick: (learning: ContentLearning) => void;
  onClear: () => void;
}) {
  if (learnings.length === 0) return null;
  const anyActive = learnings.some((l) => l.id === activeId);
  return (
    <section className="card-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-[0.01em] text-ink">{title}</h2>
          <p className="mt-0.5 text-[12px] text-ink3">{subtitle}</p>
        </div>
        {anyActive && (
          <button type="button" onClick={onClear} className="shrink-0 text-[12px] font-semibold text-ink3 hover:text-ink">
            Clear
          </button>
        )}
      </div>
      <ul className="mt-3 space-y-2">
        {learnings.map((learning) => {
          const style = LEARNING_STYLE[learning.sentiment];
          const active = activeId === learning.id;
          const traceable = learning.nodeIds.length > 0;
          const body = (
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-semibold text-ink">{learning.headline}</p>
                {learning.confidence === 'low' && (
                  <span className="rounded-badge border border-hair bg-paper2 px-1.5 py-0.5 text-[10px] font-medium text-ink3">
                    low confidence · {learning.sampleSize}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink2">{learning.detail}</p>
            </div>
          );
          return (
            <li key={learning.id}>
              <div
                className={`flex items-start justify-between gap-3 rounded-card border p-3 transition-colors ${
                  active ? 'border-ink/30 bg-paper2/80' : `${style.accent} bg-white/70`
                }`}
              >
                {traceable ? (
                  <button type="button" onClick={() => onPick(learning)} className="min-w-0 flex-1 text-left" title="Trace on the graph">
                    {body}
                  </button>
                ) : (
                  body
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {learning.metric && (
                    <span className={`rounded-badge border px-2 py-0.5 text-[12px] font-semibold tabular-nums ${style.badge}`}>
                      {learning.metric}
                    </span>
                  )}
                  {learning.action && (
                    <Link
                      href={learning.action.href}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue hover:underline"
                    >
                      {learning.action.label}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CoverageBadge({ coverage }: { coverage: number }) {
  const label = coverage >= 80 ? 'Strong' : coverage >= 50 ? 'Growing' : 'Early';
  const color = coverage >= 80 ? 'text-ink bg-lime/15 border-lime/25' : coverage >= 50 ? 'text-ink2 bg-paper2 border-hair' : 'text-ink3 bg-paper2 border-hair';

  return (
    <span className={`inline-flex items-center gap-2 rounded-badge border px-2.5 py-1 text-[12px] font-semibold ${color}`}>
      <span className="tabular-nums">{coverage}%</span>
      <span className="text-ink3">·</span>
      <span>{label}</span>
    </span>
  );
}

function InsightCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card-surface p-3.5">
      <p className="text-[12px] font-semibold tracking-[0.01em] text-ink3">{label}</p>
      <p className="mt-1 truncate text-[15px] font-semibold text-ink" title={value}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink3 tabular-nums">{hint}</p>}
    </div>
  );
}
