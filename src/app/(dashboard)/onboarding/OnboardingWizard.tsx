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
import {
  findNewConnectedAccount,
  SOCIAL_ACCOUNT_SNAPSHOT_KEY,
} from './social-connection';

const DRAFT_KEY = 'onboarding-draft';

/** Fire-and-forget analytics call that swallows failures instead of surfacing an unhandled rejection. */
function track(
  event: Parameters<typeof trackOnboardingEvent>[0],
  properties?: Record<string, string | number | boolean>,
): void {
  void trackOnboardingEvent(event, properties).catch(() => undefined);
}

interface Draft {
  displayName: string;
  focus: string;
}

type SocialConnectionFeedback =
  | { status: 'confirming' }
  | { status: 'connected'; accountName: string | null }
  | { status: 'pending' }
  | null;

const ACCOUNT_CONFIRMATION_ATTEMPTS = 4;
const ACCOUNT_CONFIRMATION_DELAY_MS = 750;

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
  const [socialConnectionFeedback, setSocialConnectionFeedback] =
    useState<SocialConnectionFeedback>(null);
  const [building, setBuilding] = useState(false);
  const [buildingLine, setBuildingLine] = useState<string>(COPY.building.lines[0]);
  const [baseline, setBaseline] = useState<CreatorBaseline | null>(null);
  const [derivedPillars, setDerivedPillars] = useState<ContentPillarConfig[]>([]);
  const [voiceDescription, setVoiceDescription] = useState('');
  const [voiceRules, setVoiceRules] = useState('');
  const [profilePillars, setProfilePillars] = useState<ContentPillarConfig[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resumed = useRef(false);
  const handledSocialReturn = useRef(false);

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
        if (data?.baseline) setBaseline(data.baseline as CreatorBaseline);
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
    track('onboarding_step_viewed', { step });
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

  // Pure navigation. Callers own clearing `error` - runIngest relies on the
  // error it just set surviving into the step it navigates to.
  const goToStep = useCallback(
    (next: StepKey) => {
      setStep(next);
      router.push(`/onboarding?step=${next}`, { scroll: false });
    },
    [router],
  );

  const refreshAccounts = useCallback(async (): Promise<ConnectedAccount[]> => {
    try {
      const res = await fetch('/api/social-accounts', { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      const connected = (data.accounts ?? []).filter(
        (a: ConnectedAccount) =>
          ['linkedin', 'twitter'].includes(a.platform) && Boolean(a.unipile_account_id),
      ) as ConnectedAccount[];
      setAccounts(connected);
      return connected;
    } catch {
      return [];
    }
  }, []);

  const waitForConnectedAccount = useCallback(async (
    previousIds: Set<string> | null,
  ): Promise<ConnectedAccount | null> => {
    for (let attempt = 0; attempt < ACCOUNT_CONFIRMATION_ATTEMPTS; attempt += 1) {
      const connected = await refreshAccounts();
      const newAccount = findNewConnectedAccount(connected, previousIds);
      if (newAccount) return newAccount;
      if (attempt < ACCOUNT_CONFIRMATION_ATTEMPTS - 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, ACCOUNT_CONFIRMATION_DELAY_MS);
        });
      }
    }
    return null;
  }, [refreshAccounts]);

  const handleConnectSocial = useCallback(() => {
    setConnecting(true);
    try {
      const ids = accounts
        .map((account) => account.unipile_account_id)
        .filter((id): id is string => Boolean(id));
      window.sessionStorage.setItem(SOCIAL_ACCOUNT_SNAPSHOT_KEY, JSON.stringify(ids));
    } catch {
      // The snapshot only disambiguates reconnects; the server remains authoritative.
    }
    window.location.href = '/api/social-accounts/connect/unipile?return=onboarding';
  }, [accounts]);

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
        track('onboarding_pillars_derived_fallback', {});
      }
      return pillars;
    } catch {
      track('onboarding_pillars_derived_fallback', {});
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
    track('onboarding_ingest_started', {});

    let lineIndex = 0;
    const ticker = window.setInterval(() => {
      lineIndex = Math.min(lineIndex + 1, COPY.building.lines.length - 1);
      setBuildingLine(COPY.building.lines[lineIndex]);
    }, 3000);

    let timeoutId = 0;
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutId = window.setTimeout(() => resolve('timeout'), 90_000);
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
        track('onboarding_ingest_timeout', {});
        setError(COPY.building.timeout);
        setDerivedPillars(await derivePillars());
      } else if (outcome === 'failed') {
        track('onboarding_ingest_failed', {});
        setError(COPY.errors.ingestFailed);
        setDerivedPillars(await derivePillars());
      } else {
        setBaseline(outcome);
      }
    } catch {
      track('onboarding_ingest_failed', {});
      setError(COPY.errors.ingestFailed);
      setDerivedPillars(await derivePillars());
    } finally {
      window.clearInterval(ticker);
      window.clearTimeout(timeoutId);
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

    // React strict mode and search-param replacement can both re-run effects.
    // A hosted-connect return must only launch one sync/poll sequence.
    if (connected && handledSocialReturn.current) return;
    if (connected) handledSocialReturn.current = true;

    if (failed) setError(COPY.steps.connect.oauthFailed);
    if (gmailReturn) setGmailConnected(true);
    if (connected) setSocialConnectionFeedback(null);

    setStep('connect');
    router.replace('/onboarding?step=connect', { scroll: false });

    void (async () => {
      if (connected) {
        setSocialConnectionFeedback({ status: 'confirming' });
        let previousIds: Set<string> | null = null;
        try {
          const raw = window.sessionStorage.getItem(SOCIAL_ACCOUNT_SNAPSHOT_KEY);
          if (raw) previousIds = new Set(JSON.parse(raw) as string[]);
        } catch {
          previousIds = null;
        }
        const syncResponse = await fetch('/api/social-accounts/sync', { method: 'POST' }).catch(
          () => null,
        );
        const newAccount = await waitForConnectedAccount(previousIds);
        try {
          window.sessionStorage.removeItem(SOCIAL_ACCOUNT_SNAPSHOT_KEY);
        } catch {
          // best effort
        }
        if (newAccount) {
          setSocialConnectionFeedback({
            status: 'connected',
            accountName: newAccount.account_name ?? null,
          });
          setError('');
        } else {
          setSocialConnectionFeedback({ status: 'pending' });
          if (syncResponse && !syncResponse.ok) setError(COPY.steps.connect.oauthFailed);
        }
      }
    })();
  }, [ready, searchParams, waitForConnectedAccount, router]);

  // Keep the account list fresh whenever the connect step is shown.
  useEffect(() => {
    if (!ready || step !== 'connect') return;
    void refreshAccounts();
  }, [ready, step, refreshAccounts]);

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

        track('onboarding_complete', {
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
      return;
    }

    if (step === 'profile') {
      // Enter on the profile step activates the same primary action as the footer button.
      await finish('leads');
    }
  }, [step, displayName, focus, accounts.length, runIngest, derivePillars, goToStep, finish, busy, building]);

  /** Skip on connect: no ingest, pillars come from the one-liner. */
  const handleSkip = useCallback(async () => {
    if (busy || building) return;
    setError('');
    track('onboarding_step_skipped', { step });
    setBusy(true);
    setDerivedPillars(await derivePillars());
    setBusy(false);
    goToStep('profile');
  }, [step, derivePillars, goToStep, busy, building]);

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

  // Load-bearing: gates all step rendering until the resume fetch has hydrated
  // `baseline`. Do not remove or bypass this - rendering the profile step early
  // would let a null baseline reach the terminal action and clobber a real
  // stored ingest result with empty values.
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
              connectionFeedback={socialConnectionFeedback}
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
        onBack={
          stepIndex > 0 && !building
            ? () => {
                setError('');
                goToStep(STEP_ORDER[stepIndex - 1]);
              }
            : undefined
        }
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
