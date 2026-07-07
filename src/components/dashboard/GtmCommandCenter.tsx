'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Linkedin, Target } from 'lucide-react';
import type { EngagementTaskRow } from '@/lib/engagement/tasks';
import type { SafetyStatusSnapshot } from '@/lib/signals/safety/guard';

interface GtmTodayData {
  safety: SafetyStatusSnapshot;
  icpConfigured: boolean;
  pipeline: {
    discovered: number;
    engaging: number;
    connectReady: number;
    connectSent: number;
    dmReady: number;
    sentToday: number;
  };
  connectsDue: Array<{
    id: string;
    company_name: string;
    rank_score: number;
    next_action_at: string | null;
  }>;
  dmsDue: Array<{
    id: string;
    company_name: string;
    rank_score: number;
    next_action_at: string | null;
  }>;
  commentDrafts: EngagementTaskRow[];
}

/**
 * Compact leads summary for the dashboard. Full pipeline + ICP setup live on /leads.
 */
export function GtmCommandCenter() {
  const [data, setData] = useState<GtmTodayData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/gtm/today');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="card-surface p-5">
        <p className="text-sm text-ink2">Loading leads summary…</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="card-surface p-5 space-y-3">
        <p className="text-sm text-ink2">Could not load leads summary.</p>
        <button type="button" onClick={() => void load()} className="btn-secondary min-h-[36px] text-sm">
          Retry
        </button>
      </section>
    );
  }

  const { pipeline, connectsDue, dmsDue, commentDrafts, icpConfigured } = data;
  const dueCount = connectsDue.length + dmsDue.length + commentDrafts.length;

  if (!icpConfigured) {
    return (
      <section className="card-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-ink2">
              <Target className="h-3.5 w-3.5" />
              Leads
            </div>
            <p className="mt-2 text-sm text-ink2 max-w-lg">
              Set up your ideal customer profile on the Leads page when you&apos;re ready to run outreach.
            </p>
          </div>
          <Link href="/leads?view=setup" className="btn-secondary min-h-[40px] shrink-0 text-sm">
            Set up on Leads
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="card-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-ink2">
            <Target className="h-3.5 w-3.5" />
            Leads today
          </div>
          <p className="mt-2 text-sm text-ink2">
            {dueCount > 0
              ? `${dueCount} item${dueCount === 1 ? '' : 's'} need a look — connects, DMs, or comment drafts.`
              : 'Pipeline is clear. Check the feed for new signals.'}
          </p>
        </div>
        <Link href="/leads" className="btn-secondary min-h-[40px] shrink-0 text-sm">
          Open leads
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PipelineStat label="Queued" value={pipeline.connectReady} />
        <PipelineStat label="Sent today" value={pipeline.sentToday} accent />
        <PipelineStat label="DM ready" value={pipeline.dmReady} />
        <PipelineStat label="Commenting" value={pipeline.engaging} />
      </div>

      {dueCount > 0 && (
        <ul className="mt-4 divide-y divide-hair rounded-xl border border-hair bg-white/70">
          {connectsDue.slice(0, 2).map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/leads?lead=${lead.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-paper2/50"
              >
                <span className="flex items-center gap-2 min-w-0 text-ink">
                  <Linkedin className="h-3.5 w-3.5 shrink-0 text-blue" />
                  <span className="truncate">Connect · {lead.company_name}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink3" />
              </Link>
            </li>
          ))}
          {dmsDue.slice(0, 1).map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/leads?lead=${lead.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-paper2/50"
              >
                <span className="truncate text-ink">DM · {lead.company_name}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink3" />
              </Link>
            </li>
          ))}
          {commentDrafts.slice(0, 1).map((task) => (
            <li key={task.id}>
              <Link
                href="/inbox?tab=outbound"
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-paper2/50"
              >
                <span className="truncate text-ink2">
                  Comment · {task.target_author_name ?? task.target_post_excerpt}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PipelineStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-hair bg-paper2/50 px-3 py-2.5">
      <p className="text-[11px] text-ink3">{label}</p>
      <p className={`font-mono text-xl font-semibold tabular-nums ${accent ? 'text-flame' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  );
}
