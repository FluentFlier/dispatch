'use client';

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2,
  Link2,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import {
  completeOnboardingFromBaseline,
  completeOnboardingFromStoredBaseline,
  completeOnboardingMinimal,
} from './actions';
import type { CreatorBaseline } from '@/lib/onboarding/baseline';
import { PRODUCT_NAME } from '@/lib/brand';

type Step = 'connect' | 'ingest' | 'baseline';

interface ConnectedAccount {
  platform: string;
  account_name: string | null;
  unipile_account_id?: string | null;
}

const INGEST_STATUS_LINES = [
  'Reading your posts…',
  'Reading your sent emails…',
  'Analyzing your hooks…',
  'Learning your voice…',
  'Pulling LinkedIn profile & web research…',
  'Building your Creator Baseline…',
  'Syncing voice, specs & posts to your brain…',
  'Verifying brain pages…',
];

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X',
};

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-200 ${
            i < current
              ? 'flex-[2] bg-accent-primary'
              : i === current
                ? 'flex-[2] bg-coral-light'
                : 'flex-1 bg-bg-tertiary'
          }`}
        />
      ))}
    </div>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('connect');
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [statusLine, setStatusLine] = useState(INGEST_STATUS_LINES[0]);
  const [baseline, setBaseline] = useState<CreatorBaseline | null>(null);
  const [finishing, setFinishing] = useState(false);
  // True once an ingest attempt has failed/timed out, so we surface an escape
  // hatch ("continue anyway") instead of trapping the user on the connect step.
  const [ingestFailed, setIngestFailed] = useState(false);
  const [enteringMinimal, setEnteringMinimal] = useState(false);
  const [unipileReady, setUnipileReady] = useState<boolean | null>(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [composioReady, setComposioReady] = useState<boolean | null>(null);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [hasBaseline, setHasBaseline] = useState(false);
  const [autoRedirecting, setAutoRedirecting] = useState(false);
  const connectedHandled = useRef(false);
  const gmailHandled = useRef(false);
  const autoConnectAttempted = useRef(false);
  const autoIngestAttempted = useRef(false);
  const resumeAttempted = useRef(false);

  const refreshAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch('/api/social-accounts');
      const data = await res.json();
      const connected = (data.accounts ?? []).filter(
        (a: ConnectedAccount) =>
          ['linkedin', 'twitter'].includes(a.platform) && Boolean(a.unipile_account_id),
      );
      setAccounts(connected);
      return connected as ConnectedAccount[];
    } catch {
      setAccounts([]);
      return [];
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const finishAndEnterApp = useCallback(
    async (nextBaseline: CreatorBaseline) => {
      setFinishing(true);
      setError('');
      try {
        await completeOnboardingFromBaseline(nextBaseline);
        void fetch('/api/brain/sync', { method: 'POST' }).catch(() => undefined);
        const topic = encodeURIComponent(nextBaseline.suggestedTopic);
        router.push(`/dashboard?welcome=1&baseline=1&topic=${topic}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to finish setup');
        setBaseline(nextBaseline);
        setStep('baseline');
        setFinishing(false);
      }
    },
    [router],
  );

  const runIngest = useCallback(async () => {
    setStep('ingest');
    setError('');
    setIngestFailed(false);
    let lineIndex = 0;
    const interval = setInterval(() => {
      lineIndex = Math.min(lineIndex + 1, INGEST_STATUS_LINES.length - 1);
      setStatusLine(INGEST_STATUS_LINES[lineIndex]);
    }, 2200);

    try {
      const res = await fetch('/api/onboarding/ingest', { method: 'POST' });
      const data = await res.json();
      clearInterval(interval);

      if (!res.ok) {
        const brainMissing = Array.isArray(data.brainCheck?.missing)
          ? (data.brainCheck.missing as string[]).join(', ')
          : '';
        setError(
          data.error ??
            (brainMissing
              ? `Brain sync incomplete (missing: ${brainMissing}). Connect another account or retry.`
              : 'Analysis failed. Connect LinkedIn or X with public posts, then try again.'),
        );
        setIngestFailed(true);
        setStep('connect');
        return;
      }

      // Backend now always completes when at least one account is connected —
      // even if posts couldn't be imported (fallback voice) or the brain only
      // partially synced. Proceed into the app rather than looping on connect.
      const nextBaseline = data.baseline as CreatorBaseline;
      setBaseline(nextBaseline);
      setHasBaseline(true);
      await finishAndEnterApp(nextBaseline);
    } catch {
      clearInterval(interval);
      setError('Something went wrong. Please try again.');
      setIngestFailed(true);
      setStep('connect');
    }
  }, [finishAndEnterApp]);

  // Escape hatch: a connected account must never trap the user. If building the
  // baseline fails or times out, complete onboarding with a minimal profile so
  // they reach the app; voice can be enriched later in Voice Lab.
  const handleContinueAnyway = useCallback(async () => {
    setEnteringMinimal(true);
    setError('');
    try {
      await completeOnboardingMinimal(accounts[0]?.account_name ?? '');
      void fetch('/api/brain/sync', { method: 'POST' }).catch(() => undefined);
      router.push('/dashboard?welcome=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue. Please try again.');
      setEnteringMinimal(false);
    }
  }, [accounts, router]);

  useEffect(() => {
    void refreshAccounts();
    fetch('/api/onboarding/status')
      .then((r) => r.json())
      .then((d) => {
        setUnipileReady(Boolean(d.unipileConfigured));
        setComposioReady(Boolean(d.composioConfigured));
        setGmailConnected(Boolean(d.gmailConnected));
        setHasBaseline(Boolean(d.hasBaseline));
      })
      .catch(() => {
        setUnipileReady(false);
        setComposioReady(false);
      });
  }, [refreshAccounts]);

  useEffect(() => {
    const connected = searchParams.get('connected') === 'true';
    const gmailReturn = searchParams.get('gmail_connected') === 'true';
    const connectError = searchParams.get('error');
    const outreachError = searchParams.get('outreach_error');

    if (connectError || outreachError) {
      setError(
        connectError
          ? 'Connection failed. Please try again.'
          : 'Gmail connection failed. Please try again.',
      );
      router.replace('/onboarding', { scroll: false });
      return;
    }

    if (gmailReturn && !gmailHandled.current) {
      gmailHandled.current = true;
      router.replace('/onboarding', { scroll: false });
      setGmailConnected(true);
      return;
    }

    if (!connected || connectedHandled.current) return;
    connectedHandled.current = true;

    router.replace('/onboarding', { scroll: false });

    void (async () => {
      await fetch('/api/social-accounts/sync', { method: 'POST' }).catch(() => undefined);
      const refreshed = await refreshAccounts();
      if (refreshed.length > 0) {
        await runIngest();
      } else {
        setError('Connect at least LinkedIn or X to continue. Pick one in the connect flow, then we will scrape your posts.');
        setAutoRedirecting(false);
        setConnecting(false);
      }
    })();
  }, [searchParams, router, refreshAccounts, runIngest]);

  // First visit with no social accounts: send straight to Unipile hosted connect.
  useEffect(() => {
    if (autoConnectAttempted.current) return;
    if (loadingAccounts || unipileReady !== true) return;
    if (step !== 'connect' || accounts.length > 0) return;
    if (searchParams.get('connected') === 'true' || searchParams.get('error')) return;

    autoConnectAttempted.current = true;
    setAutoRedirecting(true);
    setConnecting(true);

    const timer = window.setTimeout(() => {
      window.location.href = '/api/social-accounts/connect/unipile?return=onboarding';
    }, 800);

    return () => window.clearTimeout(timer);
  }, [
    loadingAccounts,
    unipileReady,
    step,
    accounts.length,
    gmailConnected,
    searchParams,
  ]);

  // Accounts already connected but knowledge not built yet: start ingest immediately.
  useEffect(() => {
    if (autoIngestAttempted.current || hasBaseline) return;
    if (loadingAccounts || unipileReady === null) return;
    if (step !== 'connect') return;
    if (searchParams.get('connected') === 'true') return;
    if (!accounts.length) return;

    autoIngestAttempted.current = true;
    void runIngest();
  }, [
    loadingAccounts,
    unipileReady,
    step,
    accounts.length,
    gmailConnected,
    hasBaseline,
    searchParams,
    runIngest,
  ]);

  // Baseline already built in a prior session — finish setup and enter the app.
  useEffect(() => {
    if (!hasBaseline || resumeAttempted.current || finishing) return;
    if (step !== 'connect') return;

    resumeAttempted.current = true;
    setFinishing(true);
    void (async () => {
      try {
        const result = await completeOnboardingFromStoredBaseline();
        void fetch('/api/brain/sync', { method: 'POST' }).catch(() => undefined);
        const topic = encodeURIComponent(result.suggestedTopic ?? 'Something I learned this week');
        router.push(`/dashboard?welcome=1&baseline=1&topic=${topic}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to resume setup');
        setFinishing(false);
      }
    })();
  }, [hasBaseline, step, finishing, router]);

  function handleConnect() {
    if (unipileReady === false) {
      setError('Social connect is still being configured. Try again shortly.');
      return;
    }
    setConnecting(true);
    window.location.href = '/api/social-accounts/connect/unipile?return=onboarding';
  }

  async function handleConnectGmail() {
    if (composioReady === false) {
      setError('Gmail connect is still being configured. Connect LinkedIn or X first.');
      return;
    }
    setConnectingGmail(true);
    setError('');
    try {
      const res = await fetch('/api/integrations/composio/link?toolkit=gmail&return=onboarding');
      const data = await res.json();
      if (!res.ok || !data.redirect_url) {
        setError(data.error ?? 'Could not start Gmail connect.');
        setConnectingGmail(false);
        return;
      }
      window.location.href = data.redirect_url as string;
    } catch {
      setError('Could not start Gmail connect.');
      setConnectingGmail(false);
    }
  }

  async function handleContinueToIngest() {
    if (accounts.length === 0) {
      setError('Connect at least LinkedIn or X to continue.');
      return;
    }
    await runIngest();
  }

  async function handleWriteFirstPost() {
    if (!baseline) return;
    setFinishing(true);
    setError('');

    try {
      await completeOnboardingFromBaseline(baseline);
      void fetch('/api/brain/sync', { method: 'POST' }).catch(() => undefined);
      const topic = encodeURIComponent(baseline.suggestedTopic);
      router.push(`/generate?welcome=1&tab=script&topic=${topic}&platform=linkedin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finish setup');
      setFinishing(false);
    }
  }

  const stepIndex = step === 'connect' ? 0 : step === 'ingest' ? 1 : 2;
  const hasLinkedIn = accounts.some((a) => a.platform === 'linkedin');
  const hasX = accounts.some((a) => a.platform === 'twitter');
  const hasSocialConnected = accounts.length > 0;
  const canBuildBaseline = hasSocialConnected;
  const ingestSources = [
    ...accounts.map((a) => PLATFORM_LABEL[a.platform]),
    ...(gmailConnected ? ['Gmail'] : []),
  ];

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink3">
        {PRODUCT_NAME} setup
      </div>
      <h1 className="font-serif text-3xl font-normal tracking-[-0.03em] text-ink">
        {step === 'baseline'
          ? 'Your Creator Baseline'
          : step === 'ingest'
            ? 'Building your knowledge base'
            : autoRedirecting
              ? 'Connect LinkedIn or X'
              : 'Connect your accounts'}
      </h1>
      <p className="mt-2 text-sm leading-6 text-ink2">
        {step === 'connect' &&
          (autoRedirecting
            ? 'Opening secure connect — link at least LinkedIn or X. We scrape your posts, extract voice & specs, and sync them to your creator brain.'
            : 'Link at least LinkedIn or X to move forward. Both is better, but one is enough. Gmail is optional for richer 1:1 voice.')}
        {step === 'ingest' && statusLine}
        {step === 'baseline' &&
          'Trained on your real writing. This is what we will sound like when we write for you.'}
      </p>

      <StepIndicator current={stepIndex} total={3} />

      {unipileReady === false && step === 'connect' && (
        <div className="mb-6 rounded-lg border border-hair bg-paper2 p-4 text-sm text-ink2">
          Social connect is finishing setup. Try again shortly.
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Escape hatch: once ingest has failed at least once, never trap a user
          with a connected account — let them into the app with a minimal profile. */}
      {ingestFailed && step === 'connect' && accounts.length > 0 && (
        <div className="mb-6 rounded-lg border border-hair bg-paper2 p-4">
          <p className="text-sm text-ink2">
            Building your voice is taking longer than expected. You can continue now and
            we&apos;ll finish learning your voice in the background — refine it anytime in Voice Lab.
          </p>
          <button
            type="button"
            onClick={() => void handleContinueAnyway()}
            disabled={enteringMinimal}
            className="btn-primary mt-4 flex w-full items-center justify-center gap-2"
          >
            {enteringMinimal ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Continue to the app
          </button>
        </div>
      )}

      {step === 'connect' && (
        <div className="space-y-6">
          {autoRedirecting && (
            <div className="flex items-center gap-3 rounded-lg border border-hair bg-paper2 p-4 text-sm text-ink2">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-primary" />
              Redirecting to LinkedIn &amp; X connect…
            </div>
          )}

          <div className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Connect LinkedIn or X (required)</p>
            <p className="mt-2 text-sm text-ink2">
              At least one social account is required. We pull your posts, voice rules, vocabulary specs, and sync everything to your brain.
            </p>

            <ul className="mt-4 space-y-3">
              {(['linkedin', 'twitter'] as const).map((platform) => {
                const connected = accounts.find((a) => a.platform === platform);
                return (
                  <li
                    key={platform}
                    className="flex items-center justify-between rounded-md border border-hair bg-paper px-4 py-3"
                  >
                    <span className="text-sm font-medium text-ink">
                      {PLATFORM_LABEL[platform]}
                    </span>
                    {connected ? (
                      <span className="flex items-center gap-1.5 text-xs text-teal">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {connected.account_name ?? 'Connected'}
                      </span>
                    ) : (
                      <span className="text-xs text-ink3">Not connected</span>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex items-center justify-between rounded-md border border-hair bg-paper px-4 py-3">
              <div>
                <span className="text-sm font-medium text-ink">Gmail</span>
                <p className="mt-0.5 text-[11px] text-ink3">Sent emails for richer voice</p>
              </div>
              {gmailConnected ? (
                <span className="flex items-center gap-1.5 text-xs text-teal">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connected
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnectGmail()}
                  disabled={connectingGmail || composioReady === false}
                  className="text-xs font-medium text-accent-primary hover:underline disabled:opacity-50"
                >
                  {connectingGmail ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting || loadingAccounts}
              className="btn-primary mt-5 flex w-full items-center justify-center gap-2"
            >
              {connecting || loadingAccounts ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {accounts.length === 0 ? 'Connect LinkedIn or X' : 'Connect another account'}
            </button>
          </div>

          {canBuildBaseline && (
            <button
              type="button"
              onClick={() => void handleContinueToIngest()}
              className="btn-primary flex w-full items-center justify-center gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Build my baseline
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          {(hasLinkedIn || hasX) && (
            <p className="text-center text-xs text-ink3">
              {hasLinkedIn && hasX
                ? 'Both connected — best coverage. Add Gmail for richer 1:1 voice.'
                : hasLinkedIn
                  ? 'LinkedIn connected — add X anytime, or continue now.'
                  : 'X connected — add LinkedIn anytime, or continue now.'}
            </p>
          )}

          {!hasSocialConnected && (
            <p className="text-center text-xs text-ink3">
              You need at least one social account before we can build your voice and brain.
            </p>
          )}
        </div>
      )}

      {step === 'ingest' && (
        <div className="flex flex-col items-center rounded-lg border border-hair bg-paper2 px-8 py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-accent-primary" />
          <p className="mt-6 font-serif text-xl text-ink">{statusLine}</p>
          <p className="mt-2 max-w-sm text-sm text-ink2">
            Pulling posts, voice specs, and profile — then verifying your brain pages…
          </p>
        </div>
      )}

      {step === 'baseline' && baseline && (
        <div className="space-y-6">
          <div className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Voice summary</p>
            <p className="mt-3 text-sm leading-7 text-ink">{baseline.voiceSummary}</p>
          </div>

          <div className={`grid gap-3 ${baseline.emailsAnalyzed > 0 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
            <div className="rounded-lg border border-hair bg-paper2 p-4">
              <p className="text-[11px] font-mono uppercase tracking-wider text-ink3">Posts read</p>
              <p className="mt-1 font-serif text-2xl text-ink">{baseline.postsAnalyzed}</p>
            </div>
            {baseline.emailsAnalyzed > 0 && (
              <div className="rounded-lg border border-hair bg-paper2 p-4">
                <p className="text-[11px] font-mono uppercase tracking-wider text-ink3">Emails read</p>
                <p className="mt-1 font-serif text-2xl text-ink">{baseline.emailsAnalyzed}</p>
              </div>
            )}
            <div className="rounded-lg border border-hair bg-paper2 p-4">
              <p className="text-[11px] font-mono uppercase tracking-wider text-ink3">Sources</p>
              <p className="mt-1 text-sm font-medium text-ink">{baseline.platforms.join(', ')}</p>
            </div>
          </div>

          <div className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Your themes</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {baseline.themes.map((theme) => (
                <span
                  key={theme}
                  className="rounded-full border border-hair bg-paper px-3 py-1 text-xs text-ink2"
                >
                  {theme}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Voice rules</p>
            <ul className="mt-3 space-y-2">
              {baseline.voiceRules.slice(0, 6).map((rule) => (
                <li key={rule} className="flex items-start gap-2 text-sm text-ink2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={() => void handleWriteFirstPost()}
            disabled={finishing}
            className="btn-primary flex w-full items-center justify-center gap-2"
          >
            {finishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Write my first post
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
        </div>
      }
    >
      <OnboardingInner />
    </Suspense>
  );
}
