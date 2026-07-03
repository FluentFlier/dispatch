'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2,
  Link2,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { completeOnboardingFromBaseline } from './actions';
import type { CreatorBaseline } from '@/lib/onboarding/baseline';
import { PRODUCT_NAME } from '@/lib/brand';

type Step = 'connect' | 'ingest' | 'baseline';

interface ConnectedAccount {
  platform: string;
  account_name: string | null;
}

const INGEST_STATUS_LINES = [
  'Reading your posts…',
  'Analyzing your hooks…',
  'Learning your voice…',
  'Building your Creator Baseline…',
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

  const refreshAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch('/api/social-accounts');
      const data = await res.json();
      const connected = (data.accounts ?? []).filter(
        (a: ConnectedAccount & { unipile_account_id?: string }) =>
          ['linkedin', 'twitter'].includes(a.platform),
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

  const runIngest = useCallback(async () => {
    setStep('ingest');
    setError('');
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
        setError(data.error ?? 'Analysis failed. Try connecting another account.');
        setStep('connect');
        return;
      }

      setBaseline(data.baseline as CreatorBaseline);
      setStep('baseline');
    } catch {
      clearInterval(interval);
      setError('Something went wrong. Please try again.');
      setStep('connect');
    }
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    const connected = searchParams.get('connected') === 'true';
    const connectError = searchParams.get('error');

    if (connectError) {
      setError('Connection failed. Please try again.');
      router.replace('/onboarding', { scroll: false });
      return;
    }

    if (!connected) return;

    router.replace('/onboarding', { scroll: false });

    void (async () => {
      await fetch('/api/social-accounts/sync', { method: 'POST' }).catch(() => undefined);
      const refreshed = await refreshAccounts();
      if (refreshed.length > 0) {
        await runIngest();
      }
    })();
  }, [searchParams, router, refreshAccounts, runIngest]);

  function handleConnect() {
    setConnecting(true);
    window.location.href = '/api/social-accounts/connect/unipile?return=onboarding';
  }

  async function handleContinueToIngest() {
    if (accounts.length === 0) {
      setError('Connect at least one account to continue.');
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
      void fetch('/api/brain/provision', { method: 'POST' }).catch(() => undefined);
      const topic = encodeURIComponent(baseline.suggestedTopic);
      router.push(`/generate?welcome=1&tab=script&topic=${topic}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finish setup');
      setFinishing(false);
    }
  }

  const stepIndex = step === 'connect' ? 0 : step === 'ingest' ? 1 : 2;
  const hasLinkedIn = accounts.some((a) => a.platform === 'linkedin');
  const hasX = accounts.some((a) => a.platform === 'twitter');

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink3">
        {PRODUCT_NAME} setup
      </div>
      <h1 className="font-serif text-3xl font-normal tracking-[-0.03em] text-ink">
        {step === 'baseline' ? 'Your Creator Baseline' : 'Connect your accounts'}
      </h1>
      <p className="mt-2 text-sm leading-6 text-ink2">
        {step === 'connect' &&
          'We analyze your posts to learn your voice — same connection powers publishing. No forms until we know you.'}
        {step === 'ingest' && statusLine}
        {step === 'baseline' &&
          'Trained on your real posts. This is what we will sound like when we write for you.'}
      </p>

      <StepIndicator current={stepIndex} total={3} />

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {step === 'connect' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Connect X + LinkedIn</p>
            <p className="mt-2 text-sm text-ink2">
              Free Creator Baseline when you connect. We only read your posts to learn your voice.
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
              {accounts.length === 0 ? 'Connect accounts' : 'Connect more accounts'}
            </button>
          </div>

          {accounts.length > 0 && (
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
                ? 'Both accounts connected — best baseline quality.'
                : 'Connect both for the richest baseline, or continue with one.'}
            </p>
          )}
        </div>
      )}

      {step === 'ingest' && (
        <div className="flex flex-col items-center rounded-lg border border-hair bg-paper2 px-8 py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-accent-primary" />
          <p className="mt-6 font-serif text-xl text-ink">{statusLine}</p>
          <p className="mt-2 max-w-sm text-sm text-ink2">
            Analyzing posts from {accounts.map((a) => PLATFORM_LABEL[a.platform]).join(' and ')}…
          </p>
        </div>
      )}

      {step === 'baseline' && baseline && (
        <div className="space-y-6">
          <div className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Voice summary</p>
            <p className="mt-3 text-sm leading-7 text-ink">{baseline.voiceSummary}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-hair bg-paper2 p-4">
              <p className="text-[11px] font-mono uppercase tracking-wider text-ink3">Posts read</p>
              <p className="mt-1 font-serif text-2xl text-ink">{baseline.postsAnalyzed}</p>
            </div>
            <div className="rounded-lg border border-hair bg-paper2 p-4">
              <p className="text-[11px] font-mono uppercase tracking-wider text-ink3">Platforms</p>
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
