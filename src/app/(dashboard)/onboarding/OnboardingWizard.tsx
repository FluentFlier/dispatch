'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { COPY, stepProgressLabel } from './copy';
import { resolveStep, STEP_ORDER, type StepKey } from './resolve-step';
import { WizardFooter } from './WizardFooter';
import { StepYou } from './steps/StepYou';
import { StepConnect, type ConnectedAccount } from './steps/StepConnect';
import { StepProfile } from './steps/StepProfile';
import {
  saveOnboardingContext,
  trackOnboardingEvent,
  completeOnboardingFromBaseline,
  completeOnboardingMinimal,
} from './actions';
import type { CreatorBaseline } from '@/lib/onboarding/baseline';
import type { ContentPillarConfig } from '@/types/database';

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
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [unipileReady, setUnipileReady] = useState<boolean | null>(null);
  const [composioReady, setComposioReady] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildingLine, setBuildingLine] = useState<string>(COPY.building.lines[0]);
  const [baseline, setBaseline] = useState<CreatorBaseline | null>(null);
  const [derivedPillars, setDerivedPillars] = useState<ContentPillarConfig[]>([]);
  const [voiceDescription, setVoiceDescription] = useState('');
  const [voiceRules, setVoiceRules] = useState('');
  const [profilePillars, setProfilePillars] = useState<ContentPillarConfig[]>([]);
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
        setUnipileReady(Boolean(data?.unipileConfigured));
        setComposioReady(Boolean(data?.composioConfigured));
        setGmailConnected(Boolean(data?.gmailConnected));
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
    if (!ready) return;
    writeDraft({ displayName, focus });
  }, [ready, displayName, focus]);

  // Prefill the profile step from whichever source produced it.
  useEffect(() => {
    if (baseline) {
      setVoiceDescription(baseline.voiceSummary);
      setVoiceRules(baseline.voiceRules.join('\n'));
      setProfilePillars(baseline.pillars);
      return;
    }
    if (derivedPillars.length > 0) setProfilePillars(derivedPillars);
  }, [baseline, derivedPillars]);

  const goToStep = useCallback(
    (next: StepKey) => {
      setError('');
      setStep(next);
      router.push(`/onboarding?step=${next}`, { scroll: false });
    },
    [router],
  );

  const refreshAccounts = useCallback(async (): Promise<ConnectedAccount[]> => {
    try {
      const res = await fetch('/api/social-accounts');
      const data = await res.json();
      const connected = (data.accounts ?? []).filter(
        (a: ConnectedAccount) =>
          ['linkedin', 'twitter'].includes(a.platform) && Boolean(a.unipile_account_id),
      ) as ConnectedAccount[];
      setAccounts(connected);
      return connected;
    } catch {
      setAccounts([]);
      return [];
    }
  }, []);

  const handleConnectSocial = useCallback(() => {
    setConnecting(true);
    window.location.href = '/api/social-accounts/connect/unipile?return=onboarding';
  }, []);

  const handleConnectGmail = useCallback(async () => {
    setConnectingGmail(true);
    setError('');
    try {
      const res = await fetch('/api/integrations/composio/link?toolkit=gmail&return=onboarding');
      const data = await res.json();
      if (!res.ok || !data.redirect_url) {
        setError(COPY.steps.connect.composioUnavailable);
        setConnectingGmail(false);
        return;
      }
      window.location.href = data.redirect_url as string;
    } catch {
      setError(COPY.steps.connect.composioUnavailable);
      setConnectingGmail(false);
    }
  }, []);

  /** Derives pillars from the one-liner for users with no ingest baseline. */
  const derivePillars = useCallback(async (): Promise<ContentPillarConfig[]> => {
    try {
      const res = await fetch('/api/onboarding/derive-pillars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: focus }),
      });
      const data = await res.json();
      const pillars = (data?.pillars ?? []) as ContentPillarConfig[];
      if (pillars.length === 0) {
        void trackOnboardingEvent('onboarding_pillars_derived_fallback', {});
      }
      return pillars;
    } catch {
      void trackOnboardingEvent('onboarding_pillars_derived_fallback', {});
      return [];
    }
  }, [focus]);

  /**
   * Runs ingest with a hard 90s ceiling. Whatever happens - success, failure, or
   * timeout - the user ends up on the profile step with a usable profile.
   */
  const runIngest = useCallback(async () => {
    setBuilding(true);
    setError('');
    void trackOnboardingEvent('onboarding_ingest_started', {});

    let lineIndex = 0;
    const ticker = window.setInterval(() => {
      lineIndex = Math.min(lineIndex + 1, COPY.building.lines.length - 1);
      setBuildingLine(COPY.building.lines[lineIndex]);
    }, 3000);

    const timeout = new Promise<'timeout'>((resolve) => {
      window.setTimeout(() => resolve('timeout'), 90_000);
    });

    try {
      const outcome = await Promise.race([
        fetch('/api/onboarding/ingest', { method: 'POST' }).then(async (res) => {
          const data = await res.json().catch(() => null);
          return res.ok && data?.baseline ? (data.baseline as CreatorBaseline) : 'failed';
        }),
        timeout,
      ]);

      if (outcome === 'timeout') {
        void trackOnboardingEvent('onboarding_ingest_timeout', {});
        setError(COPY.building.timeout);
        setDerivedPillars(await derivePillars());
      } else if (outcome === 'failed') {
        void trackOnboardingEvent('onboarding_ingest_failed', {});
        setError(COPY.errors.ingestFailed);
        setDerivedPillars(await derivePillars());
      } else {
        setBaseline(outcome);
      }
    } catch {
      void trackOnboardingEvent('onboarding_ingest_failed', {});
      setError(COPY.errors.ingestFailed);
      setDerivedPillars(await derivePillars());
    } finally {
      window.clearInterval(ticker);
      setBuilding(false);
      goToStep('profile');
    }
  }, [derivePillars, goToStep]);

  // Returning from Unipile or Composio: land on connect, sync, and refresh.
  useEffect(() => {
    if (!ready) return;
    const connected = searchParams.get('connected') === 'true';
    const gmailReturn = searchParams.get('gmail_connected') === 'true';
    const failed = searchParams.get('error') ?? searchParams.get('outreach_error');

    if (!connected && !gmailReturn && !failed) return;

    if (failed) setError(COPY.steps.connect.oauthFailed);
    if (gmailReturn) setGmailConnected(true);

    void (async () => {
      if (connected) {
        await fetch('/api/social-accounts/sync', { method: 'POST' }).catch(() => undefined);
        await refreshAccounts();
      }
      router.replace('/onboarding?step=connect', { scroll: false });
      setStep('connect');
    })();
  }, [ready, searchParams, refreshAccounts, router]);

  // Keep the account list fresh whenever the connect step is shown.
  useEffect(() => {
    if (!ready || step !== 'connect') return;
    void refreshAccounts();
  }, [ready, step, refreshAccounts]);

  const handleNext = useCallback(async () => {
    if (busy || building) return;
    setError('');

    if (step === 'you') {
      if (!displayName.trim()) {
        setError(COPY.errors.nameRequired);
        return;
      }
      setBusy(true);
      try {
        await saveOnboardingContext(displayName, focus);
      } catch {
        // Context is a convenience, never a gate.
      } finally {
        setBusy(false);
      }
      goToStep('connect');
      return;
    }

    if (step === 'connect') {
      if (accounts.length > 0) {
        await runIngest();
        return;
      }
      setBusy(true);
      setDerivedPillars(await derivePillars());
      setBusy(false);
      goToStep('profile');
    }
  }, [step, displayName, focus, accounts.length, runIngest, derivePillars, goToStep, busy, building]);

  /** Skip on connect: no ingest, pillars come from the one-liner. */
  const handleSkip = useCallback(async () => {
    if (busy || building) return;
    void trackOnboardingEvent('onboarding_step_skipped', { step });
    setBusy(true);
    setDerivedPillars(await derivePillars());
    setBusy(false);
    goToStep('profile');
  }, [step, derivePillars, goToStep, busy, building]);

  /**
   * Terminal action. Writes onboarding_complete exactly once, then routes. The
   * dashboard layout guard bounces completed users off /onboarding, so the
   * handoff must complete before navigating.
   */
  const finish = useCallback(
    async (destination: 'leads' | 'dashboard') => {
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        if (baseline) {
          await completeOnboardingFromBaseline({
            ...baseline,
            displayName: displayName.trim() || baseline.displayName,
            voiceSummary: voiceDescription,
            voiceRules: voiceRules.split('\n').map((r) => r.trim()).filter(Boolean),
            pillars: profilePillars,
          });
        } else {
          await completeOnboardingMinimal(displayName, profilePillars, {
            description: voiceDescription,
            rules: voiceRules,
          });
        }

        void trackOnboardingEvent('onboarding_complete', {
          path: baseline ? 'connected' : 'skipped',
          destination,
        });

        try {
          window.sessionStorage.removeItem(DRAFT_KEY);
        } catch {
          // best effort
        }

        void fetch('/api/brain/sync', { method: 'POST' }).catch(() => undefined);
        router.push(destination === 'leads' ? '/leads' : '/dashboard?welcome=1');
      } catch {
        setError(COPY.errors.saveFailed);
        setBusy(false);
      }
    },
    [busy, baseline, displayName, voiceDescription, voiceRules, profilePillars, router],
  );

  const stepIndex = STEP_ORDER.indexOf(step);

  // Enter advances only outside text controls, so multi-line fields still work.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      if (target.closest('button, a, [role="button"], input, textarea, select, [contenteditable="true"]')) return;
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

          {step === 'connect' && (
            <StepConnect
              accounts={accounts}
              gmailConnected={gmailConnected}
              unipileReady={unipileReady}
              composioReady={composioReady}
              connecting={connecting}
              connectingGmail={connectingGmail}
              onConnectSocial={handleConnectSocial}
              onConnectGmail={() => void handleConnectGmail()}
              building={building}
              buildingLine={buildingLine}
            />
          )}

          {step === 'profile' && (
            <StepProfile
              voiceDescription={voiceDescription}
              onVoiceDescriptionChange={setVoiceDescription}
              voiceRules={voiceRules}
              onVoiceRulesChange={setVoiceRules}
              pillars={profilePillars}
              onPillarsChange={setProfilePillars}
            />
          )}
        </div>
      </div>

      <WizardFooter
        onBack={stepIndex > 0 && !building ? () => goToStep(STEP_ORDER[stepIndex - 1]) : undefined}
        onNext={step === 'profile' ? () => void finish('leads') : () => void handleNext()}
        nextLabel={step === 'profile' ? COPY.footer.finishToLeads : undefined}
        onSkip={
          building
            ? undefined
            : step === 'connect'
              ? () => void handleSkip()
              : step === 'profile'
                ? () => void finish('dashboard')
                : undefined
        }
        skipLabel={step === 'profile' ? COPY.footer.finishToDashboard : undefined}
        canAdvance={step !== 'you' || displayName.trim().length > 0}
        busy={busy || building}
      />
    </div>
  );
}
