'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
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
      setMessage('Brain ready');
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
      <div className="rounded-lg border border-border bg-bg-secondary p-4 animate-pulse h-24" />
    );
  }

  if (status?.migration_required) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-amber-800">
          <Brain className="h-4 w-4" />
          <span className="text-sm font-medium">Creator Brain</span>
        </div>
        <p className="mt-2 text-xs text-text-tertiary">
          Apply <code className="text-text-secondary">db/creator-brain.sql</code> on InsForge to enable memory pages.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent-primary" />
            <span className="text-sm font-medium text-text-primary">Creator Brain</span>
          </div>
          <p className="mt-1 text-xs text-text-tertiary">
            {status?.provisioned
              ? `${status.page_count} memory pages · drafts use your voice + what already shipped`
              : 'Your long-term memory for AI drafts — voice, profile, and top posts'}
          </p>
          {message && (
            <p className="mt-2 text-xs text-accent-primary">{message}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {!status?.provisioned ? (
            <Button size="sm" variant="secondary" onClick={handleProvision} disabled={syncing}>
              Set up
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
