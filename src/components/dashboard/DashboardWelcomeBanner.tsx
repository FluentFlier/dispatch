'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Post-onboarding welcome strip on the dashboard. Links to Write with the suggested topic.
 */
export function DashboardWelcomeBanner() {
  const searchParams = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const topic = searchParams.get('topic') ?? '';
  const [dismissed, setDismissed] = useState(false);

  if (!isWelcome || dismissed) return null;

  const writeHref = topic
    ? `/generate?welcome=1&tab=script&topic=${encodeURIComponent(topic)}`
    : '/generate?welcome=1&tab=script';

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-teal/30 bg-teal/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-teal" />
        <div>
          <p className="text-sm font-semibold text-ink">Your voice is ready</p>
          <p className="mt-0.5 text-sm text-ink2">
            {topic
              ? 'We drafted a starter topic from your baseline — open Write to generate your first post.'
              : 'Open Write to generate your first post in your voice.'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-8 sm:pl-0">
        <Link href={writeHref} className="btn-primary min-h-[40px] text-sm">
          Write first post
          <ArrowRight className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="btn-ghost min-h-[40px] px-2"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
