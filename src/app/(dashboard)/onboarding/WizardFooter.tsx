'use client';

import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { COPY } from './copy';

interface WizardFooterProps {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  onSkip?: () => void;
  skipLabel?: string;
  canAdvance: boolean;
  busy?: boolean;
}

/**
 * The only navigation surface in onboarding. Rendered by the shell in a fixed
 * bottom zone so Back and the primary action never move between steps - the
 * whole point of the paged layout is that the buttons are always in one place.
 */
export function WizardFooter({
  onBack,
  onNext,
  nextLabel,
  onSkip,
  skipLabel,
  canAdvance,
  busy = false,
}: WizardFooterProps) {
  return (
    <div className="shrink-0 border-t border-hair bg-paper">
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-4">
        <div className="flex-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={busy}
              className="flex items-center gap-1.5 text-sm text-ink2 transition-colors hover:text-ink disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" />
              {COPY.footer.back}
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="text-sm text-ink3 transition-colors hover:text-ink2 disabled:opacity-50"
            >
              {skipLabel ?? COPY.footer.skip}
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={!canAdvance || busy}
            className="btn-primary flex items-center justify-center gap-2 px-6"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? COPY.footer.saving : (nextLabel ?? COPY.footer.next)}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
