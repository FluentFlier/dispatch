'use client';

import { useState } from 'react';

/**
 * Redeems a trial access code, then hands off to /auth/continue which routes the
 * now-provisioned user into onboarding.
 */
export default function AccessCodeForm() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter a code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/billing/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not redeem that code.');
        return;
      }
      // Full navigation so the server re-evaluates access and routes to onboarding.
      window.location.assign('/auth/continue');
    } catch {
      setError('Network error - try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="e.g. LINKEDIN"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        disabled={loading}
        className="w-full rounded-md border border-border bg-bg-secondary px-4 py-3 text-[15px] font-mono uppercase tracking-wide text-ink placeholder:text-ink3 focus:border-accent-primary focus:outline-none disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full justify-center"
      >
        {loading ? 'Checking…' : 'Start free trial'}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
