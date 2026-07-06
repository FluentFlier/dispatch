'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface FlagToggleProps {
  name: string;
  enabled: boolean;
  description: string | null;
}

/**
 * Client toggle for feature flag kill switches.
 */
export function FlagToggle({ name, enabled, description }: FlagToggleProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setLoading(true);
    setError(null);
    const next = !current;
    try {
      const res = await fetch(`/api/admin/flags/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Update failed');
      }
      setCurrent(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[#2a2d35] bg-[#1a1d24] px-4 py-3">
      <div className="min-w-0">
        <p className="font-mono text-sm text-white">{name}</p>
        {description ? <p className="text-xs text-[#6b7280] mt-0.5">{description}</p> : null}
        {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={() => void toggle()}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          current ? 'bg-emerald-600' : 'bg-[#374151]'
        }`}
        aria-pressed={current}
        aria-label={`Toggle ${name}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            current ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
