'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2 } from 'lucide-react';
import { completeOnboarding } from './actions';
import type { ContentPillarConfig } from '@/types/database';
import { CHATGPT_VOICE_EXPORT_PROMPT } from '@/lib/voice-import-prompt';

const PILLAR_COLOR = '#E07A5F';

const DEFAULT_VOICE =
  'Direct, casual, and specific. Short sentences. Talk to the reader like a smart friend — no corporate fluff.';
const DEFAULT_RULES = 'Never use em dashes. No generic influencer speak.';

type Mode = 'manual' | 'import';

function seedPillars(bio: string): ContentPillarConfig[] {
  const trimmed = bio.trim();
  const firstLine = trimmed.split(/\n/)[0]?.trim() ?? '';
  const name =
    firstLine.length > 0
      ? firstLine.replace(/^I(?:'m| am)\s+/i, '').slice(0, 48).trim() || 'My posts'
      : 'My posts';
  return [
    {
      name: name.length > 32 ? 'My posts' : name,
      color: PILLAR_COLOR,
      description: trimmed.slice(0, 240) || undefined,
    },
  ];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('manual');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [about, setAbout] = useState('');
  const [voiceDescription, setVoiceDescription] = useState('');
  const [voiceRules, setVoiceRules] = useState('');
  const [importPaste, setImportPaste] = useState('');

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.profile?.displayName) {
          setDisplayName(data.profile.displayName);
          return;
        }
        const email = data?.user?.email as string | undefined;
        if (email?.includes('@')) {
          const guess = email.split('@')[0]?.replace(/[._+-]/g, ' ').trim();
          if (guess) setDisplayName(guess.charAt(0).toUpperCase() + guess.slice(1));
        }
      })
      .catch(() => undefined);
  }, []);

  const canFinish =
    displayName.trim().length > 0 &&
    about.trim().length > 0 &&
    voiceDescription.trim().length > 0;

  async function saveProfile(payload: {
    displayName: string;
    bio: string;
    voiceDescription: string;
    voiceRules: string;
  }) {
    await completeOnboarding({
      displayName: payload.displayName,
      bio: payload.bio,
      voiceDescription: payload.voiceDescription,
      voiceRules: payload.voiceRules,
      pillars: seedPillars(payload.bio || payload.displayName),
      contextAdditions: payload.bio,
    });

    try {
      await fetch('/api/brain/provision', { method: 'POST' });
    } catch {
      // Non-blocking
    }

    router.push('/dashboard');
  }

  const handleFinish = async () => {
    setError('');
    if (!canFinish) {
      setError('Fill in your name, what you do, and how you write — or use import / skip.');
      return;
    }

    setLoading(true);
    try {
      await saveProfile({
        displayName: displayName.trim(),
        bio: about.trim(),
        voiceDescription: voiceDescription.trim(),
        voiceRules: voiceRules.trim(),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setError('');
    setLoading(true);
    const name = displayName.trim() || 'Creator';
    try {
      await saveProfile({
        displayName: name,
        bio: about.trim(),
        voiceDescription: voiceDescription.trim() || DEFAULT_VOICE,
        voiceRules: voiceRules.trim() || DEFAULT_RULES,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CHATGPT_VOICE_EXPORT_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy — select the prompt and copy manually.');
    }
  };

  const handleImport = async () => {
    setError('');
    if (!importPaste.trim()) {
      setError('Paste the export from ChatGPT or Claude first.');
      return;
    }

    setImporting(true);
    try {
      const res = await fetch('/api/onboarding/import-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: importPaste }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      const name = (data.displayName as string | null) || displayName.trim();
      const bio = (data.bio as string | null) || about.trim();
      const voice = (data.voiceDescription as string | null) || voiceDescription.trim();
      const rules = (data.voiceRules as string | null) || voiceRules.trim();

      if (!name || !voice) {
        setDisplayName(name || displayName);
        setAbout(bio || about);
        setVoiceDescription(voice || voiceDescription);
        setVoiceRules(rules || voiceRules);
        setMode('manual');
        setError('Partial import — fill any blanks, then start writing.');
        return;
      }

      setLoading(true);
      await saveProfile({
        displayName: name,
        bio: bio || voice,
        voiceDescription: voice,
        voiceRules: rules,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      setLoading(false);
    }
  };

  const inputCls =
    'w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors';
  const textareaCls = `${inputCls} resize-none`;
  const labelCls = 'block font-body text-[13px] font-medium text-text-primary mb-2';

  return (
    <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-serif text-[28px] font-normal tracking-[-0.025em] text-ink">
            Set up your profile
          </h1>
          <p className="text-[14px] leading-6 text-text-secondary">
            One-time voice setup. Answer a few questions, import from ChatGPT, or skip.
          </p>
        </div>

        <div className="flex gap-1 rounded-lg bg-bg-tertiary p-1">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`flex-1 rounded-md py-2 text-[13px] font-medium transition-colors ${
              mode === 'manual'
                ? 'bg-bg-secondary text-text-primary shadow-card'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Quick questions
          </button>
          <button
            type="button"
            onClick={() => setMode('import')}
            className={`flex-1 rounded-md py-2 text-[13px] font-medium transition-colors ${
              mode === 'import'
                ? 'bg-bg-secondary text-text-primary shadow-card'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            ChatGPT / Claude
          </button>
        </div>

        {mode === 'manual' ? (
          <div className="rounded-lg border border-border bg-bg-secondary p-6 shadow-card space-y-5">
            <div>
              <label className={labelCls} htmlFor="onboarding-name">
                Your name
              </label>
              <input
                id="onboarding-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex Chen"
                className={inputCls}
                autoFocus
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="onboarding-about">
                What do you do?
              </label>
              <textarea
                id="onboarding-about"
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                rows={3}
                placeholder="I'm a founder building tools for sales teams. I post about GTM and lessons from early customers."
                className={textareaCls}
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="onboarding-voice">
                How should your posts sound?
              </label>
              <textarea
                id="onboarding-voice"
                value={voiceDescription}
                onChange={(e) => setVoiceDescription(e.target.value)}
                rows={4}
                placeholder="Direct and casual — short sentences, specific examples."
                className={textareaCls}
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="onboarding-rules">
                Anything to avoid? <span className="font-normal text-text-tertiary">(optional)</span>
              </label>
              <textarea
                id="onboarding-rules"
                value={voiceRules}
                onChange={(e) => setVoiceRules(e.target.value)}
                rows={2}
                placeholder="No corporate jargon, no emoji…"
                className={textareaCls}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Step 1 — Copy this prompt</p>
                  <p className="mt-1 text-[12px] text-text-secondary">
                    Paste it into ChatGPT, Claude, or Gemini. Copy the reply.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-[12px] font-medium text-text-primary hover:border-border-hover"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="max-h-40 overflow-auto rounded-md border border-border bg-bg-tertiary p-3 text-[11px] leading-5 text-text-secondary whitespace-pre-wrap">
                {CHATGPT_VOICE_EXPORT_PROMPT}
              </pre>
            </div>

            <div className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card space-y-3">
              <p className="text-[13px] font-medium text-text-primary">Step 2 — Paste the export</p>
              <textarea
                value={importPaste}
                onChange={(e) => setImportPaste(e.target.value)}
                rows={10}
                placeholder="Paste what ChatGPT or Claude returned…"
                className={textareaCls}
              />
            </div>
          </div>
        )}

        {error && <p className="text-[13px] text-accent-primary text-center">{error}</p>}

        <div className="space-y-2">
          {mode === 'manual' ? (
            <button
              type="button"
              onClick={handleFinish}
              disabled={loading || !canFinish}
              className="w-full rounded-md py-3 px-6 text-text-inverse font-body text-[14px] font-medium bg-accent-primary hover:bg-accent-dark transition-colors disabled:opacity-40"
            >
              {loading ? 'Saving…' : 'Start writing'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleImport}
              disabled={loading || importing || !importPaste.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md py-3 px-6 text-text-inverse font-body text-[14px] font-medium bg-accent-primary hover:bg-accent-dark transition-colors disabled:opacity-40"
            >
              {(loading || importing) && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading || importing ? 'Importing…' : 'Import & start writing'}
            </button>
          )}

          <button
            type="button"
            onClick={handleSkip}
            disabled={loading || importing}
            className="w-full py-2 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-40"
          >
            Skip for now — use defaults
          </button>

          <p className="text-center text-[12px] text-text-tertiary pt-1">
            Connect social accounts later in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}
