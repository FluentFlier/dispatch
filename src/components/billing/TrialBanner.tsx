'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TrialState {
  active: boolean;
  daysLeft: number;
}

/**
 * Shows remaining trial days and a subscribe CTA while the app trial is active.
 */
export default function TrialBanner() {
  const [trial, setTrial] = useState<TrialState | null>(null);

  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { trial?: TrialState }) => {
        if (data.trial?.active) setTrial(data.trial);
      })
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  if (!trial?.active) return null;

  const urgent = trial.daysLeft <= 2;

  return (
    <div
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
        urgent
          ? 'border-coral/40 bg-coral-light text-text-primary'
          : 'border-border bg-bg-secondary text-text-secondary'
      }`}
    >
      <span>
        <span className="font-medium text-text-primary">Free trial</span>
        {' · '}
        {trial.daysLeft === 1
          ? '1 day left'
          : `${trial.daysLeft} days left`}
        {' — '}
        Starter access ends soon. Subscribe to keep publishing.
      </span>
      <Link href="/pricing" className="btn-primary text-[13px] min-h-[40px] px-4">
        Choose a plan
      </Link>
    </div>
  );
}
