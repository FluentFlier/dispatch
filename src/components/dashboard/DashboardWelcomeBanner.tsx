'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';

/**
 * One-time welcome banner shown after onboarding redirects to the dashboard
 * with `?welcome=1`. Client component so it can read the query param and be
 * dismissed without a navigation. Renders nothing when the flag is absent or
 * after the user dismisses it.
 */
export function DashboardWelcomeBanner() {
  const searchParams = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const [dismissed, setDismissed] = useState(false);

  if (!isWelcome || dismissed) return null;

  return (
    <div className="card-surface flex items-start gap-3 border-blue/20 bg-blue/5 p-5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue/10 text-blue">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">You are all set</p>
        <p className="mt-1 text-sm text-ink3">
          Your voice baseline is ready. Draft a post, review your leads, or explore your morning brief below to get started.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss welcome message"
        className="shrink-0 rounded-md p-1 text-ink3 transition-colors hover:bg-paper2 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default DashboardWelcomeBanner;
