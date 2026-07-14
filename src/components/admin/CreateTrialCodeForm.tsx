'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLANS = ['starter', 'growth', 'pro', 'unlimited'] as const;

/**
 * Admin form to create a reusable trial code with a plan tier, trial length,
 * and optional redemption cap.
 */
export function CreateTrialCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [plan, setPlan] = useState<string>('starter');
  const [trialDays, setTrialDays] = useState('7');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/trial-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          plan,
          trialDays: Number(trialDays),
          maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
          note: note.trim() || null,
        }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || !data.ok) {
        setIsError(true);
        setMessage(data.error ?? 'Could not create code.');
        return;
      }
      setIsError(false);
      setMessage(`Created ${data.ok ? code.trim().toUpperCase() : ''}`);
      setCode('');
      setMaxRedemptions('');
      setNote('');
      router.refresh();
    } catch {
      setIsError(true);
      setMessage('Network error — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink3">Code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="LINKEDIN"
          required
          className="w-40 rounded-md border border-border bg-bg-secondary px-3 py-1.5 text-sm font-mono uppercase tracking-wide"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink3">Plan</span>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="select-field min-h-0 py-1.5 px-2 text-sm"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink3">Trial days</span>
        <input
          type="number"
          min={1}
          max={365}
          value={trialDays}
          onChange={(e) => setTrialDays(e.target.value)}
          required
          className="w-24 rounded-md border border-border bg-bg-secondary px-3 py-1.5 text-sm tabular-nums"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink3">Max uses (blank = ∞)</span>
        <input
          type="number"
          min={1}
          value={maxRedemptions}
          onChange={(e) => setMaxRedemptions(e.target.value)}
          placeholder="∞"
          className="w-28 rounded-md border border-border bg-bg-secondary px-3 py-1.5 text-sm tabular-nums"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1 min-w-[160px]">
        <span className="text-[11px] text-ink3">Note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Campaign name"
          className="w-full rounded-md border border-border bg-bg-secondary px-3 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-dark disabled:opacity-50"
      >
        {loading ? 'Creating…' : 'Create code'}
      </button>
      {message ? (
        <span className={`text-xs ${isError ? 'text-red-600' : 'text-emerald-700'}`}>{message}</span>
      ) : null}
    </form>
  );
}
