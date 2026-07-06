'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface VoiceDriftReport {
  drifted: boolean;
  delta: number;
  baselineFidelity: number;
  currentFidelity: number;
  message: string;
}

/**
 * Surfaces /api/voice-drift so creators know when to re-import posts in Voice Lab.
 */
export function VoiceDriftCard() {
  const [report, setReport] = useState<VoiceDriftReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/voice-drift', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as VoiceDriftReport;
        if (!cancelled) setReport(data);
      } catch {
        /* optional card */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking voice fidelity…
      </div>
    );
  }

  if (!report || report.baselineFidelity <= 0) return null;

  const Icon = report.drifted ? AlertTriangle : CheckCircle2;
  const tone = report.drifted ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-sage/30 bg-sage-light/30';

  return (
    <div className={`mb-6 rounded-lg border px-4 py-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${report.drifted ? 'text-accent-primary' : 'text-sage'}`} />
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">
            {report.drifted ? 'Voice drift detected' : 'Voice fidelity stable'}
          </p>
          <p className="mt-1 text-xs text-text-secondary">{report.message}</p>
          <p className="mt-2 font-mono text-[11px] text-text-tertiary">
            Baseline {report.baselineFidelity.toFixed(1)} → current {report.currentFidelity.toFixed(1)}
            {report.delta > 0 ? ` (−${report.delta.toFixed(1)})` : ''}
          </p>
          {report.drifted && (
            <Link href="/voice-lab" className="mt-3 inline-block text-xs font-medium text-accent-primary hover:underline">
              Re-import posts in Voice Lab →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
