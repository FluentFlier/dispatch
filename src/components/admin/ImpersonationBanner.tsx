'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ImpersonationBannerProps {
  targetDisplayName: string;
  targetUserId: string;
}

/**
 * Warning banner shown while an admin is impersonating a user in the creator app.
 */
export function ImpersonationBanner({ targetDisplayName, targetUserId }: ImpersonationBannerProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function endImpersonation(): Promise<void> {
    setLoading(true);
    try {
      await fetch('/api/admin/impersonate', { method: 'DELETE' });
      router.push('/admin/users');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Impersonating <strong>{targetDisplayName}</strong>
          <span className="font-mono text-xs text-amber-800 ml-1">({targetUserId.slice(0, 8)}…)</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => void endImpersonation()}
        disabled={loading}
        className="rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
      >
        {loading ? 'Ending…' : 'End impersonation'}
      </button>
    </div>
  );
}
