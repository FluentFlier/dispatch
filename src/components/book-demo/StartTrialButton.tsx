'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Starts the one-time 7-day app trial and sends the user to the dashboard.
 */
export default function StartTrialButton({ className }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function startTrial() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/billing/start-trial', { method: 'POST' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not start trial');
        return;
      }
      router.push('/onboarding');
      router.refresh();
    } catch {
      setError('Network error — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startTrial}
        disabled={loading}
        className={
          className ??
          'btn-primary w-full sm:w-auto'
        }
      >
        {loading ? 'Starting trial…' : 'Start 7-day free trial'}
      </button>
      {error ? (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      ) : (
        <p className="mt-2 text-xs text-text-tertiary">
          Full Starter access for 7 days. No card. Next: quick profile setup.
        </p>
      )}
    </div>
  );
}
