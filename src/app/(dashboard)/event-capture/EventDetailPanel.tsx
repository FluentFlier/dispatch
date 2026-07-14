'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, PenLine, RefreshCw } from 'lucide-react';
import {
  useCaptureDetail,
  submitAnswers,
  regenerateQuestions,
  regenerateDraft,
  type CapturePost,
} from './useEventCapture';
import { buildWriteUrl } from '@/lib/event-capture/draft-context';

interface EventDetailPanelProps {
  id: string;
  /** Called after a successful submit so the parent can re-pull the inbox. */
  onSubmitted?: () => void;
}

/** Opens the Write (/generate) editor prefilled with a generated draft. */
function writeUrl(post: CapturePost, title: string): string {
  return buildWriteUrl(post.script ?? post.caption ?? '', title);
}

/**
 * Detail panel for a single capture. Q&A form (with a reload-questions option),
 * a generating state, and the drafted state which auto-opens the draft in the
 * Write editor. A failed/empty draft offers a one-click regenerate.
 */
export function EventDetailPanel({ id, onSubmitted }: EventDetailPanelProps) {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const detail = useCaptureDetail(id, refreshKey);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<null | 'reload' | 'regen'>(null);
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef<string | null>(null);

  const capture = detail?.capture;
  const posts = detail?.posts ?? [];

  // Auto-open the draft in Write once it is ready (per product decision).
  // Depend on the stable `detail` object (new ref only on refetch) so the effect
  // does not re-fire every render on a fresh `posts` array literal.
  useEffect(() => {
    const cap = detail?.capture;
    const ps = detail?.posts ?? [];
    if (cap?.status === 'drafted' && ps.length > 0 && openedRef.current !== cap.id) {
      openedRef.current = cap.id;
      router.push(writeUrl(ps[0], cap.title));
    }
  }, [detail, router]);

  // Prefill the answer form from whatever is already stored server-side. Runs on
  // every fetch (load, reload, regenerate) rather than just mount, so answers
  // the user already gave for THIS capture are visible instead of silently
  // discarded, and so switching to a different capture doesn't leave a stale
  // answer set typed for the previous one behind.
  useEffect(() => {
    const cap = detail?.capture;
    if (cap) setAnswers(cap.answers ?? {});
  }, [detail]);

  if (!detail || !capture) {
    return <p className="text-sm text-text-tertiary">Loading…</p>;
  }

  const { research } = detail;
  const questions = capture.questions ?? [];
  const answeredCount = Object.values(answers).filter((v) => v.trim().length > 0).length;

  const handleReload = async (): Promise<void> => {
    if (!window.confirm('Reload questions? This replaces the current questions and clears your saved answers.')) return;
    setBusy('reload');
    setError(null);
    try {
      const res = await regenerateQuestions(id);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not reload questions');
      }
      setAnswers({});
      setRefreshKey((k) => k + 1);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reload questions');
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerate = async (): Promise<void> => {
    setBusy('regen');
    setError(null);
    try {
      const res = await regenerateDraft(id, answers);
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not regenerate draft');
      }
      openedRef.current = null; // allow auto-open when the new draft lands
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate draft');
    } finally {
      setBusy(null);
    }
  };

  // --- Drafted ---
  if (capture.status === 'drafted') {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-display text-text-primary">{capture.title}</h2>
        {posts.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-text-tertiary">
              Draft generation didn&apos;t save a post.
              {questions.length > 0
                ? ' Answer (or update) at least one question below, then generate again - or reload for a fresh set of questions.'
                : ' Reload the questions to try again.'}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}

            {questions.length > 0 && (
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <label key={i} className="block space-y-1.5">
                    <span className="text-sm text-text-primary">{q}</span>
                    <textarea
                      className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                      rows={2}
                      maxLength={500}
                      value={answers[String(i)] ?? ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [String(i)]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleRegenerate}
                disabled={busy !== null || (questions.length > 0 && answeredCount < 1)}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md bg-accent-primary text-white disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${busy === 'regen' ? 'animate-spin' : ''}`} />
                {questions.length > 0 ? `Generate draft (${answeredCount}/${questions.length} answered)` : 'Regenerate draft'}
              </button>
              <button
                onClick={handleReload}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md border border-border text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
              >
                Reload questions
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-secondary">Opening in Write… you can edit and humanize it there.</p>
            {posts.map((p) => (
              <article key={p.id} className="rounded-lg border border-border bg-bg-primary p-4 space-y-2">
                <p className="text-xs tracking-wide text-text-tertiary">{p.platform}</p>
                <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                  {p.script ?? p.caption ?? ''}
                </p>
                <button
                  onClick={() => router.push(writeUrl(p, capture.title))}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-accent-primary text-white hover:bg-accent-dark"
                >
                  <PenLine className="h-3.5 w-3.5" /> Edit in Write
                </button>
              </article>
            ))}
          </>
        )}
      </div>
    );
  }

  // --- Drafting ---
  if (capture.status === 'drafting') {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-display text-text-primary">{capture.title}</h2>
        <p className="inline-flex items-center gap-2 text-sm text-text-secondary">
          <Sparkles className="h-4 w-4 animate-pulse" />
          Generating your draft…
        </p>
      </div>
    );
  }

  // --- Questions ready ---
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (answeredCount < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitAnswers(id, answers);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not submit answers');
      }
      setRefreshKey((k) => k + 1); // pick up the 'drafting' status + resume poll
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit answers');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-display text-text-primary">{capture.title}</h2>
        <button
          type="button"
          onClick={handleReload}
          disabled={busy !== null}
          title="Generate a fresh set of questions for this event (clears current answers)"
          className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium px-3 py-1.5 rounded-md border border-border text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy === 'reload' ? 'animate-spin' : ''}`} /> Reload questions
        </button>
      </div>

      {research?.summary && (
        <p className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">{research.summary}</p>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</p>
      )}

      {questions.map((q, i) => (
        <label key={i} className="block space-y-1.5">
          <span className="text-sm text-text-primary">{q}</span>
          <textarea
            className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
            rows={2}
            maxLength={500}
            value={answers[String(i)] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [String(i)]: e.target.value }))}
          />
        </label>
      ))}

      <button
        type="submit"
        disabled={answeredCount < 1 || submitting}
        className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-md bg-accent-primary text-white disabled:opacity-50 min-h-[44px]"
      >
        <Sparkles className="h-4 w-4" />
        {submitting ? 'Submitting…' : `Generate draft (${answeredCount}/${questions.length} answered)`}
      </button>
    </form>
  );
}
