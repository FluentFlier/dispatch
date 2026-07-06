'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface TrendDetectActionProps {
  /** When true, show the refresh control even if trends exist. */
  showWhenEmpty?: boolean;
  hasTrend?: boolean;
}

/**
 * Triggers /api/trends/detect and reloads the dashboard so Morning Brief picks up fresh trends.
 */
export function TrendDetectAction({ showWhenEmpty = true, hasTrend = false }: TrendDetectActionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!showWhenEmpty && hasTrend) return null;

  async function refreshTrends() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/trends/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? 'Trend detection failed');
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh trends');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <Button variant="ghost" size="sm" onClick={refreshTrends} loading={loading} className="h-7 px-2 text-xs">
        <RefreshCw className="mr-1 h-3 w-3" />
        {hasTrend ? 'Refresh trends' : 'Detect trends'}
      </Button>
      {error && <p className="mt-1 text-[11px] text-accent-primary">{error}</p>}
    </div>
  );
}
