'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BrainGraph, BrainGraphNode, BrainNodeKind } from '@/lib/brain/graph';
import { BrainGraphCanvas, KIND_LABELS } from './BrainGraphCanvas';

interface GraphResponse extends BrainGraph {
  provisioned: boolean;
  page_count: number;
  last_updated: string | null;
  migration_required?: boolean;
  error?: string;
}

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
  pillar: '#D4A054',
  post: '#5B8FA8',
  story: '#E07A5F',
};

export function BrainGraphView() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<BrainGraphNode | null>(null);

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
        setMessage(`Synced ${json.synced_posts ?? 0} posts into memory`);
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

  const counts = useMemo(() => {
    const map = new Map<BrainNodeKind, number>();
    for (const n of graph.nodes) map.set(n.kind, (map.get(n.kind) ?? 0) + 1);
    return map;
  }, [graph.nodes]);

  if (loading) {
    return <div className="h-[560px] animate-pulse rounded-xl border border-hair bg-white/60" />;
  }

  if (data?.migration_required) {
    return (
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-6">
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
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-hair bg-white/60 py-20 text-center">
        <Brain className="mb-4 h-10 w-10 text-blue" />
        <h2 className="font-serif text-[20px] font-normal tracking-[-0.02em] text-ink">Your brain is empty</h2>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            title="Refresh memory from profile and published posts"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        </div>
      </div>

      <div className="relative">
        <div className="h-[560px] w-full">
          <BrainGraphCanvas graph={graph} selectedId={selected?.id ?? null} onSelect={setSelected} />
        </div>

        {selected && (
          <aside className="absolute right-3 top-3 w-72 rounded-xl border border-hair bg-white/95 p-4 shadow-card backdrop-blur-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="section-label">{KIND_LABELS[selected.kind]}</span>
                <h3 className="mt-1 text-[15px] font-semibold leading-tight text-ink">{selected.label}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
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
                    <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink3">{key}</dt>
                    <dd className="text-[13px] font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {selected.slug && (
              <p className="mt-3 border-t border-hair pt-2 font-mono text-[10px] text-ink3">{selected.slug}</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
