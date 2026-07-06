'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';

interface RetryJobButtonProps {
  jobId: string;
}

/**
 * Re-queues a failed or dead publish job via admin API.
 */
export function RetryJobButton({ jobId }: RetryJobButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function retry(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/publish-jobs/${jobId}/retry`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        alert(body.error ?? 'Retry failed');
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => void retry()}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-accent-primary hover:bg-accent-light disabled:opacity-50"
    >
      <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
      Retry
    </button>
  );
}
