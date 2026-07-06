'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import type { LoopReadinessResponse } from '@/app/api/loop/readiness/route';

/**
 * Shows what's left before the engage loop (replies + warm outreach) is fully live.
 */
export default function LoopReadinessCard() {
  const [data, setData] = useState<LoopReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/loop/readiness');
      if (!res.ok) return;
      setData((await res.json()) as LoopReadinessResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="rounded-lg border border-border bg-bg-secondary p-4 h-24 animate-pulse" />;
  }

  if (!data || data.complete) return null;

  const pending = data.steps.filter((s) => !s.done);

  return (
    <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
      <div className="flex items-center gap-2">
        <AlertCircle size={16} className="text-accent-primary shrink-0" />
        <h2 className="text-sm font-semibold text-text-primary">Engage loop setup</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        {pending.length} step{pending.length === 1 ? '' : 's'} left before replies and warm outreach run smoothly.
      </p>
      <div className="mt-4 space-y-2">
        {data.steps.map((step) => (
          <Link
            key={step.id}
            href={step.href}
            className={`flex items-center gap-2 px-3 py-3 rounded-md text-sm transition-colors min-h-[44px] ${
              step.done
                ? 'bg-sage-light text-accent-secondary'
                : 'bg-bg-tertiary text-text-secondary hover:bg-border'
            }`}
          >
            {step.done ? (
              <CheckCircle2 size={16} className="text-accent-secondary shrink-0" />
            ) : (
              <span className="w-4 h-4 rounded-full border-2 border-border shrink-0" />
            )}
            <span className={step.done ? 'line-through opacity-70' : ''}>{step.label}</span>
            {step.detail && !step.done && (
              <span className="ml-1 text-xs text-text-tertiary truncate">{step.detail}</span>
            )}
            {!step.done && <ArrowRight size={14} className="ml-auto text-text-tertiary shrink-0" />}
          </Link>
        ))}
      </div>
    </section>
  );
}
