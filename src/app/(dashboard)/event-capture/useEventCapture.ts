'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Capture status values the inbox surfaces. Mirrors the statuses the
 * GET /api/event-capture route filters to (questions_ready, drafting, drafted).
 */
export type CaptureStatus = 'questions_ready' | 'drafting' | 'drafted';

/** One inbox row. Shape matches the columns selected by GET /api/event-capture. */
export interface CaptureSummary {
  id: string;
  title: string;
  event_type: string;
  end_time: string;
  status: CaptureStatus;
}

/**
 * A single generated post as returned by GET /api/event-capture/[id].
 * The route selects `script` and `caption` (no voice-score column exists in the
 * posts table), so the UI reads those and nothing else.
 */
export interface CapturePost {
  id: string;
  platform: string;
  script: string | null;
  caption: string | null;
  status: string;
}

/** Research summary block from event_research (only `summary` is shown in the UI). */
export interface CaptureResearch {
  summary?: string | null;
}

/**
 * Full detail payload for one capture. `capture` carries the questions the user
 * answers; `posts` is populated only once status flips to 'drafted'.
 */
export interface CaptureDetail {
  capture: {
    id: string;
    title: string;
    event_type: string;
    end_time: string;
    status: CaptureStatus;
    questions: string[] | null;
    answers: Record<string, string> | null;
  };
  research: CaptureResearch | null;
  posts: CapturePost[];
}

// --- Inbox ---

/**
 * Loads the event-capture inbox (questions_ready + drafting + drafted), newest
 * first. Uses cookie auth via credentials: 'same-origin' to match every other
 * dashboard fetch in this app. Exposes `refresh` so callers can re-pull after
 * dismissing a capture.
 */
export function useInbox(): {
  items: CaptureSummary[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<CaptureSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/event-capture', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to load event captures');
      const json = (await res.json()) as { captures?: CaptureSummary[] };
      setItems(json.captures ?? []);
    } catch (err) {
      console.error('[event-capture] inbox load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, refresh };
}

// --- Detail (with drafting poll) ---

/**
 * Loads one capture's detail and, while its status is 'drafting', re-polls every
 * 3 seconds so the freshly generated draft appears without a manual refresh.
 * Cleans up the timer on unmount or when `id` changes to avoid stale polls
 * writing into a detail panel the user has already navigated away from.
 */
export function useCaptureDetail(id: string | null, refreshKey = 0): CaptureDetail | null {
  const [detail, setDetail] = useState<CaptureDetail | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/event-capture/${id}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Failed to load capture detail');
        const json = (await res.json()) as CaptureDetail;
        if (!active) return;
        setDetail(json);
        // Keep polling only while the backend is still generating the draft.
        if (json.capture?.status === 'drafting') {
          timer = setTimeout(() => void load(), 3000);
        }
      } catch (err) {
        console.error('[event-capture] detail load failed', err);
      }
    };

    void load();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, refreshKey]);

  return detail;
}

// --- Mutations ---

/**
 * Submits the user's Q&A answers (at least one required) which flips the capture
 * into 'drafting' and kicks off background draft generation server-side.
 */
export async function submitAnswers(
  id: string,
  answers: Record<string, string>,
): Promise<Response> {
  return fetch(`/api/event-capture/${id}/answers`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
}

/** Soft-dismisses a capture so it drops out of the inbox on the next refresh. */
export async function dismissCapture(id: string): Promise<Response> {
  return fetch(`/api/event-capture/${id}/dismiss`, {
    method: 'POST',
    credentials: 'same-origin',
  });
}

/**
 * Reloads the question set for one capture (fresh research + new LLM questions)
 * without re-importing the calendar. Clears stored answers server-side.
 */
export async function regenerateQuestions(id: string): Promise<Response> {
  return fetch(`/api/event-capture/${id}/regenerate-questions`, {
    method: 'POST',
    credentials: 'same-origin',
  });
}

/** Re-runs draft generation from stored answers (recovers a failed/empty draft). */
export async function regenerateDraft(id: string): Promise<Response> {
  return fetch(`/api/event-capture/${id}/regenerate-draft`, {
    method: 'POST',
    credentials: 'same-origin',
  });
}
