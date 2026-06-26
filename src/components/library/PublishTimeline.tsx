'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface PublishJob {
  id: string;
  platform: string;
  status: string;
  last_error: string | null;
  provider_url: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  published: CheckCircle2,
  failed: XCircle,
  dead: XCircle,
  queued: Clock,
  processing: Loader2,
};

const STATUS_COLOR: Record<string, string> = {
  published: 'text-[#10B981]',
  failed: 'text-[#F87171]',
  dead: 'text-[#F87171]',
  queued: 'text-accent-primary',
  processing: 'text-text-tertiary',
};

export default function PublishTimeline({ limit = 8 }: { limit?: number }) {
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/publish-jobs')
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((data) => setJobs((data.jobs ?? []).slice(0, limit)))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [limit]);

  async function retry(jobId: string) {
    await fetch('/api/publish-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });
    const res = await fetch('/api/publish-jobs');
    if (res.ok) {
      const data = await res.json();
      setJobs((data.jobs ?? []).slice(0, limit));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-[13px] py-4">
        <Loader2 size={14} className="animate-spin" /> Loading publish activity…
      </div>
    );
  }

  if (jobs.length === 0) {
    return <p className="text-[13px] text-text-secondary py-2">No publish activity yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {jobs.map((job) => {
        const Icon = STATUS_ICON[job.status] ?? Clock;
        const color = STATUS_COLOR[job.status] ?? 'text-text-secondary';
        return (
          <li
            key={job.id}
            className="flex items-start gap-3 py-2 border-b border-hair last:border-0"
          >
            <Icon
              size={14}
              className={`mt-0.5 shrink-0 ${color} ${job.status === 'processing' ? 'animate-spin' : ''}`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-ink capitalize">{job.platform}</span>
                <span className="font-mono text-[10px] text-ink3 uppercase tracking-[0.08em]">{job.status}</span>
              </div>
              {job.last_error && (
                <p className="text-[11px] text-[#F87171] mt-0.5 line-clamp-2">{job.last_error}</p>
              )}
              {job.provider_url && (
                <a
                  href={job.provider_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-accent-primary hover:underline mt-0.5 inline-block"
                >
                  View post
                </a>
              )}
            </div>
            {(job.status === 'failed' || job.status === 'dead') && (
              <button
                type="button"
                onClick={() => retry(job.id)}
                className="text-[11px] text-accent-primary hover:text-accent-primary shrink-0"
              >
                Retry
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
