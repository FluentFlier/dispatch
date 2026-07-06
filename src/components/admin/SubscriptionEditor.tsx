'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLANS = ['free', 'starter', 'growth', 'pro', 'unlimited'] as const;
const STATUSES = ['inactive', 'trialing', 'active', 'past_due', 'canceled'] as const;

interface SubscriptionEditorProps {
  userId: string;
  plan: string;
  status: string;
}

/**
 * Inline editor for manual subscription overrides (support / ops).
 */
export function SubscriptionEditor({ userId, plan, status }: SubscriptionEditorProps) {
  const router = useRouter();
  const [editPlan, setEditPlan] = useState(plan);
  const [editStatus, setEditStatus] = useState(status);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: editPlan, status: editStatus }),
      });
      const body = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      setMessage('Saved');
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={editPlan}
        onChange={(e) => setEditPlan(e.target.value)}
        className="select-field min-h-0 py-1 px-2 text-xs"
      >
        {PLANS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select
        value={editStatus}
        onChange={(e) => setEditStatus(e.target.value)}
        className="select-field min-h-0 py-1 px-2 text-xs"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={loading}
        onClick={() => void save()}
        className="rounded-md bg-accent-primary px-2 py-1 text-xs font-medium text-text-inverse hover:bg-accent-dark disabled:opacity-50"
      >
        {loading ? '…' : 'Save'}
      </button>
      {message ? (
        <span className={`text-xs ${message === 'Saved' ? 'text-emerald-700' : 'text-red-600'}`}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
