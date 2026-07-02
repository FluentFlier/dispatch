'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useCaptureDetail, submitAnswers } from './useEventCapture';

interface EventDetailPanelProps {
  id: string;
  /** Called after a successful submit so the parent can re-pull the inbox. */
  onSubmitted?: () => void;
}

/**
 * Detail panel for a single capture. Shows the research summary, then a Q&A form
 * (at least one answer required to submit). Once submitted the capture flips to
 * 'drafting' and the polling hook swaps this over to a generating state, then to
 * the generated draft(s) when status becomes 'drafted'. Voice score is not shown
 * because the posts API does not return one.
 */
export function EventDetailPanel({ id, onSubmitted }: EventDetailPanelProps) {
  const detail = useCaptureDetail(id);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!detail) {
    return <p className="text-sm text-text-tertiary">Loading…</p>;
  }

  const { capture, research, posts } = detail;

  // --- Drafted: show the generated post(s) ---
  if (capture.status === 'drafted') {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-display text-text-primary">{capture.title}</h2>
        {posts.length === 0 ? (
          <p className="text-sm text-text-tertiary">
            No draft was generated. Try dismissing and re-capturing this event.
          </p>
        ) : (
          posts.map((p) => (
            <article
              key={p.id}
              className="rounded-lg border border-border bg-bg-primary p-4 space-y-2"
            >
              <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">
                {p.platform}
              </p>
              <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                {p.script ?? p.caption ?? ''}
              </p>
            </article>
          ))
        )}
      </div>
    );
  }

  // --- Drafting: generation in progress (poll will flip us to drafted) ---
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

  // --- Questions ready: answer the generated questions (at least one required) ---
  const questions = capture.questions ?? [];
  const answeredCount = Object.values(answers).filter((v) => v.trim().length > 0).length;

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
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit answers');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <h2 className="text-xl font-display text-text-primary">{capture.title}</h2>

      {research?.summary && (
        <p className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">
          {research.summary}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {questions.map((q, i) => (
        <label key={i} className="block space-y-1.5">
          <span className="text-sm text-text-primary">{q}</span>
          <textarea
            className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
            rows={2}
            maxLength={500}
            value={answers[String(i)] ?? ''}
            onChange={(e) =>
              setAnswers((a) => ({ ...a, [String(i)]: e.target.value }))
            }
          />
        </label>
      ))}

      <button
        type="submit"
        disabled={answeredCount < 1 || submitting}
        className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-md bg-accent-primary text-white disabled:opacity-50 min-h-[44px]"
      >
        <Sparkles className="h-4 w-4" />
        {submitting
          ? 'Submitting…'
          : `Generate draft (${answeredCount}/${questions.length} answered)`}
      </button>
    </form>
  );
}
