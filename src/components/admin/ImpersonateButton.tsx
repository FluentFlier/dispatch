'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UserCog } from 'lucide-react';

interface ImpersonateButtonProps {
  userId: string;
  displayName: string;
}

/**
 * Starts admin impersonation and redirects to the creator dashboard as the target user.
 */
export function ImpersonateButton({ userId, displayName }: ImpersonateButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    if (!confirm(`View the app as ${displayName}? You will see their data until you end impersonation.`)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to start impersonation');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="inline-flex items-center gap-1 text-[11px] text-accent-primary hover:underline disabled:opacity-50"
      >
        <UserCog className="w-3 h-3" />
        {loading ? 'Starting…' : 'Impersonate'}
      </button>
      {error ? <p className="text-[10px] text-red-600 mt-0.5">{error}</p> : null}
    </div>
  );
}
