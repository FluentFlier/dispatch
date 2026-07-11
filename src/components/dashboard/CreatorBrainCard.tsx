'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Brain, Network, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface BrainStatusResponse {
  provisioned: boolean;
  page_count: number;
  slugs: string[];
  last_updated: string | null;
  migration_required?: boolean;
}

export function CreatorBrainCard() {
  const [status, setStatus] = useState<BrainStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brain/status');
      const data = (await res.json()) as BrainStatusResponse;
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleProvision = async () => {
    setSyncing(true);
    setMessage('');
    try {
      const res = await fetch('/api/brain/provision', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMessage(`Memory ready · ${data.synced_posts ?? 0} posts synced`);
      await loadStatus();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    try {
      const res = await fetch('/api/brain/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setMessage(`Synced ${data.synced_posts ?? 0} posts`);
      await loadStatus();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="card-surface p-4 animate-pulse h-24" />
    );
  }

  if (status?.migration_required) {
    return (
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-amber-800">
          <Brain className="h-4 w-4" />
          <span className="text-sm font-medium">Creator Brain</span>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Apply <code className="text-ink2">db/creator-brain.sql</code> on InsForge to enable memory pages.
        </p>
      </div>
    );
  }

  return (
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-blue" />
            <span className="text-sm font-medium text-ink">Creator Brain</span>
          </div>
          <p className="mt-1 text-xs text-ink3">
            {status?.provisioned
              ? `${status.page_count} memory pages · drafts use your voice + what already shipped`
              : 'Your long-term memory for AI drafts: voice, profile, and top posts'}
          </p>
          {message && (
            <p className="mt-2 text-xs text-blue">{message}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {!status?.provisioned ? (
            <Button size="sm" variant="secondary" onClick={handleProvision} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Set up'}
            </Button>
          ) : (
            <>
              <Link
                href="/brain"
                title="Visualize your Creator Brain as a graph"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-hair2 bg-white/90 px-3 text-sm text-ink backdrop-blur-sm transition-colors hover:border-blue/25 hover:bg-white"
              >
                <Network className="h-3.5 w-3.5" />
                Graph
              </Link>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSync}
                disabled={syncing}
                title="Refresh memory from profile and published posts"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
