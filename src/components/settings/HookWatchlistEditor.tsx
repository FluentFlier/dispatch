'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface WatchlistEntry {
  id: string;
  handle: string;
  platform: string;
  priority: number;
  enabled: boolean;
}

/**
 * Settings UI for workspace hook-mining watchlist (Pro tier: custom Apify/GStack targets).
 */
export default function HookWatchlistEditor() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hooks/watchlist');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Load failed');
      setEntries(data.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load watchlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addHandle(e: FormEvent) {
    e.preventDefault();
    const trimmed = handle.replace(/^@+/, '').trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/hooks/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: trimmed, platform: 'x' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setHandle('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add handle');
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(id: string) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/hooks/watchlist?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Delete failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove handle');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading hook watchlist…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-text-secondary">
        Creators we mine for high-converting hooks. Defaults apply until you add your own (Pro).
      </p>

      <form onSubmit={addHandle} className="flex flex-wrap gap-2">
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="levelsio"
          className="min-w-[180px] flex-1 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-[13px] focus:outline-none focus:border-border-hover"
        />
        <Button type="submit" loading={saving} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add creator
        </Button>
      </form>

      {error && <p className="text-[12px] text-accent-primary">{error}</p>}

      {entries.length === 0 ? (
        <p className="text-[12px] text-text-tertiary">No custom creators yet - global defaults are used for mining.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
              <span>
                @{entry.handle.replace(/^@+/, '')}{' '}
                <span className="text-text-tertiary">· {entry.platform} · p{entry.priority}</span>
              </span>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                disabled={saving}
                className="rounded p-1 text-text-secondary hover:text-accent-primary"
                aria-label={`Remove @${entry.handle}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
