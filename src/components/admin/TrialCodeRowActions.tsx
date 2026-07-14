'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Per-row enable/disable + delete controls for a trial code.
 */
export function TrialCodeRowActions({ code, active }: { code: string; active: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const encoded = encodeURIComponent(code);

  async function toggle(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/trial-codes/${encoded}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Update failed');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete code ${code}? This cannot be undone.`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/trial-codes/${encoded}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Delete failed');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => void toggle()}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-ink2 hover:bg-paper2/60 disabled:opacity-50"
      >
        {active ? 'Disable' : 'Enable'}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => void remove()}
        className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
