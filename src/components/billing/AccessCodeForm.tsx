'use client';

import { useState } from 'react';

/**
 * Validates an access code before authentication, then carries it through sign-in
 * in a short-lived, HttpOnly cookie. Signed-in users follow the same path and are
 * routed straight through redemption.
 */
export default function AccessCodeForm({ initialError = '' }: { initialError?: string }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);

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
      const res = await fetch('/api/billing/prepare-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not redeem that code.');
        return;
      }
      // The login middleware sends already-authenticated users through the same
      // pending-code redemption path without showing the sign-in UI again.
      window.location.assign('/login');
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
