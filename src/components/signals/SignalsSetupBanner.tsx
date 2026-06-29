'use client';

import Link from 'next/link';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

export interface SignalsSetupState {
  hasSources: boolean;
  linkedInConnected: boolean;
  sendingReady: boolean;
  dryRun: boolean;
  outreachEnabled: boolean;
}

interface SignalsSetupBannerProps {
  setup: SignalsSetupState;
  enablingSend: boolean;
  onEnableSending: () => void;
}

function Step({
  done,
  label,
  href,
}: {
  done: boolean;
  label: string;
  href?: string;
}) {
  const inner = (
    <>
      {done ? (
        <CheckCircle2 size={16} className="text-accent-secondary shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full border-2 border-border shrink-0" />
      )}
      <span className={done ? 'line-through opacity-70' : ''}>{label}</span>
      {!done && href && <ArrowRight size={14} className="ml-auto text-text-tertiary" />}
    </>
  );

  if (href && !done) {
    return (
      <Link
        href={href}
        className="flex items-center gap-2 px-3 py-3 rounded-md text-sm transition-colors min-h-[44px] bg-bg-tertiary text-text-secondary hover:bg-border"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 py-3 rounded-md text-sm min-h-[44px] ${
        done ? 'bg-sage-light text-accent-secondary' : 'bg-bg-tertiary text-text-secondary'
      }`}
    >
      {inner}
    </div>
  );
}

export function SignalsSetupBanner({
  setup,
  enablingSend,
  onEnableSending,
}: SignalsSetupBannerProps) {
  const complete =
    setup.hasSources && setup.linkedInConnected && setup.sendingReady;

  if (complete) return null;

  const needsEnable =
    setup.hasSources &&
    setup.linkedInConnected &&
    (!setup.outreachEnabled || setup.dryRun);

  return (
    <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
      <div className="flex items-center gap-2">
        <AlertCircle size={16} className="text-accent-primary shrink-0" />
        <h2 className="text-sm font-semibold text-text-primary">Get started in 3 steps</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        Follow founders, connect LinkedIn, then draft and send outreach when they raise or join an
        accelerator.
      </p>
      <div className="mt-4 space-y-2">
        <Step done={setup.hasSources} label="Follow accounts on X or LinkedIn" />
        <Step
          done={setup.linkedInConnected}
          label="Connect LinkedIn for sending"
          href="/settings?tab=publishing"
        />
        <Step done={setup.sendingReady} label="Turn on sending" />
      </div>
      {needsEnable && (
        <button
          type="button"
          disabled={enablingSend}
          onClick={onEnableSending}
          className="mt-4 inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto px-5 rounded-md text-sm font-medium bg-accent-primary text-white hover:opacity-90 disabled:opacity-50"
        >
          {enablingSend ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Turning on…
            </>
          ) : (
            'Turn on sending'
          )}
        </button>
      )}
    </section>
  );
}
