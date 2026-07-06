'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useCallback } from 'react';
import { Search } from 'lucide-react';

const PLANS = ['', 'free', 'starter', 'growth', 'pro', 'unlimited'] as const;
const STATUSES = ['', 'inactive', 'trialing', 'active', 'past_due', 'canceled'] as const;

/**
 * GET form for filtering the admin user directory by name, plan, status, and onboarding.
 */
export function UserSearchForm() {
  const router = useRouter();
  const params = useSearchParams();

  const q = params.get('q') ?? '';
  const plan = params.get('plan') ?? '';
  const status = params.get('status') ?? '';
  const onboarding = params.get('onboarding') ?? '';

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const next = new URLSearchParams();
      const keys = ['q', 'plan', 'status', 'onboarding'] as const;
      for (const key of keys) {
        const val = fd.get(key);
        if (typeof val === 'string' && val.trim()) next.set(key, val.trim());
      }
      router.push(`/admin/users?${next.toString()}`);
    },
    [router],
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 mb-6">
      <label className="flex flex-col gap-1 text-xs text-text-secondary min-w-[180px] flex-1">
        Search name
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-text-tertiary" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Display name…"
            className="w-full rounded-md border border-border bg-bg-secondary pl-8 pr-3 py-2 text-sm text-text-primary"
          />
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        Plan
        <select
          name="plan"
          defaultValue={plan}
          className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm min-w-[120px]"
        >
          <option value="">All</option>
          {PLANS.filter(Boolean).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        Status
        <select
          name="status"
          defaultValue={status}
          className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm min-w-[120px]"
        >
          <option value="">All</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        Onboarding
        <select
          name="onboarding"
          defaultValue={onboarding}
          className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm min-w-[130px]"
        >
          <option value="">All</option>
          <option value="complete">Complete</option>
          <option value="incomplete">Incomplete</option>
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Filter
      </button>
      {(q || plan || status || onboarding) && (
        <button
          type="button"
          onClick={() => router.push('/admin/users')}
          className="text-xs text-text-secondary hover:text-text-primary py-2"
        >
          Clear
        </button>
      )}
    </form>
  );
}
