'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { COPY, stepProgressLabel } from './copy';
import { resolveStep, STEP_ORDER, type StepKey } from './resolve-step';
import { WizardFooter } from './WizardFooter';
import { StepYou } from './steps/StepYou';
import { saveOnboardingContext, trackOnboardingEvent } from './actions';

const DRAFT_KEY = 'onboarding-draft';

interface Draft {
  displayName: string;
  focus: string;
}

function readDraft(): Draft {
  if (typeof window === 'undefined') return { displayName: '', focus: '' };
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return { displayName: '', focus: '' };
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return { displayName: String(parsed.displayName ?? ''), focus: String(parsed.focus ?? '') };
  } catch {
    return { displayName: '', focus: '' };
  }
}

function writeDraft(draft: Draft): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // storage unavailable - the draft is a convenience, never a requirement
  }
}

export default function OnboardingWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<StepKey>('you');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [focus, setFocus] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resumed = useRef(false);

  // Resume once from server state. An explicit ?step= always wins so Back works.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;

    const draft = readDraft();
    setDisplayName(draft.displayName);
    setFocus(draft.focus);

    const requested = searchParams.get('step');
    fetch('/api/onboarding/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const next = resolveStep(
          {
            connectedCount: Number(data?.connectedCount ?? 0),
            hasBaseline: Boolean(data?.hasBaseline),
          },
          requested,
        );
        setStep(next);
      })
      .catch(() => setStep(resolveStep({ connectedCount: 0, hasBaseline: false }, requested)))
      .finally(() => setReady(true));
  }, [searchParams]);

  // Move focus to the step heading on every change so keyboard and screen
  // reader users are not stranded at the top of the document.
  useEffect(() => {
    if (!ready) return;
    headingRef.current?.focus();
    void trackOnboardingEvent('onboarding_step_viewed', { step });
  }, [step, ready]);

  useEffect(() => {
    writeDraft({ displayName, focus });
  }, [displayName, focus]);

  const goToStep = useCallback(
    (next: StepKey) => {
      setError('');
      setStep(next);
      router.push(`/onboarding?step=${next}`, { scroll: false });
    },
    [router],
  );

  const handleNext = useCallback(async () => {
    setError('');
    if (step === 'you') {
      if (!displayName.trim()) {
        setError(COPY.errors.nameRequired);
        return;
      }
      setBusy(true);
      try {
        await saveOnboardingContext(displayName, focus);
        goToStep('connect');
      } catch {
        // Context is a convenience, never a gate. Advance regardless.
        goToStep('connect');
      } finally {
        setBusy(false);
      }
    }
  }, [step, displayName, focus, goToStep]);

  const stepIndex = STEP_ORDER.indexOf(step);

  // Enter advances only outside text controls, so multi-line fields still work.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      e.preventDefault();
      void handleNext();
    },
    [handleNext],
  );

  if (!ready) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-paper" onKeyDown={handleKeyDown}>
      {/* Top zone: fixed height, never scrolls */}
      <div className="shrink-0 border-b border-hair">
        <div className="mx-auto w-full max-w-xl px-4 pb-5 pt-8">
          <div className="mb-2 text-[11px] tracking-[0.12em] text-ink3">{COPY.eyebrow}</div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-normal tracking-[-0.03em] text-ink outline-none"
          >
            {COPY.steps[step].title}
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-ink2">{COPY.steps[step].subtitle}</p>

          <div
            className="mt-5 flex items-center gap-2"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STEP_ORDER.length}
            aria-valuenow={stepIndex + 1}
            aria-label={stepProgressLabel(step, stepIndex, STEP_ORDER.length)}
          >
            {STEP_ORDER.map((key, i) => (
              <div
                key={key}
                className={`h-1.5 flex-1 rounded-full transition-all duration-200 ${
                  i <= stepIndex ? 'bg-accent-primary' : 'bg-bg-tertiary'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Middle zone: the only scrollable region */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 py-8">
          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {step === 'you' && (
            <StepYou
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
              focus={focus}
              onFocusChange={setFocus}
            />
          )}
        </div>
      </div>

      <WizardFooter
        onBack={stepIndex > 0 ? () => goToStep(STEP_ORDER[stepIndex - 1]) : undefined}
        onNext={() => void handleNext()}
        canAdvance={step !== 'you' || displayName.trim().length > 0}
        busy={busy}
      />
    </div>
  );
}
