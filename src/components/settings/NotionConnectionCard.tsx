'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2, RefreshCw, Unplug } from 'lucide-react';

interface NotionStatus {
  connected: boolean;
  workspace_name?: string | null;
  user_name?: string | null;
  source_urls?: string[];
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  setup_required?: boolean;
}

export default function NotionConnectionCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [sources, setSources] = useState('');
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations/notion');
      const data = await response.json() as NotionStatus;
      setStatus(data);
      setSources((data.source_urls ?? []).join('\n'));
    } catch {
      setStatus({ connected: false, setup_required: true });
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function sync() {
    const sourceUrls = sources.split(/[\n,]/).map((url) => url.trim()).filter(Boolean);
    if (!sourceUrls.length) {
      setMessage({ type: 'error', text: 'Paste at least one Notion page or database URL.' });
      return;
    }
    setBusy('sync');
    setMessage(null);
    try {
      const response = await fetch('/api/integrations/notion/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_urls: sourceUrls }),
      });
      const data = await response.json() as { error?: string; imported?: number };
      if (!response.ok) throw new Error(data.error ?? 'Notion sync failed.');
      setMessage({ type: 'success', text: `Pulled ${data.imported ?? sourceUrls.length} Notion source${(data.imported ?? sourceUrls.length) === 1 ? '' : 's'} into your context.` });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Notion sync failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setMessage(null);
    try {
      const response = await fetch('/api/integrations/notion', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not disconnect Notion.');
      setStatus({ connected: false });
      setSources('');
      setMessage({ type: 'success', text: 'Notion disconnected. Previously imported context was kept.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not disconnect Notion.' });
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return <div className="flex items-center gap-2 text-xs text-text-secondary"><Loader2 size={14} className="animate-spin" /> Loading Notion…</div>;
  }

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-secondary">
            <BookOpen size={17} className="text-text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-text-primary">Notion</p>
            <p className="mt-0.5 text-[11px] text-text-secondary">
              {status.connected
                ? `Connected${status.workspace_name ? ` to ${status.workspace_name}` : ''}${status.user_name ? ` as ${status.user_name}` : ''}`
                : 'Pull selected pages into the context used for generation.'}
            </p>
          </div>
        </div>
        {status.connected ? (
          <button type="button" onClick={() => void disconnect()} disabled={busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] text-text-secondary hover:border-border-hover hover:text-text-primary disabled:opacity-50">
            {busy === 'disconnect' ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />} Disconnect
          </button>
        ) : status.setup_required ? (
          <button type="button" disabled
            className="shrink-0 rounded-md bg-text-primary px-3 py-1.5 text-[11px] font-medium text-bg-primary opacity-40">
            Connect Notion
          </button>
        ) : (
          <a href="/api/integrations/notion/connect"
            className="shrink-0 rounded-md bg-text-primary px-3 py-1.5 text-[11px] font-medium text-bg-primary hover:opacity-90">
            Connect Notion
          </a>
        )}
      </div>

      {status.setup_required && (
        <p className="mt-3 rounded-md border border-coral/30 bg-coral/5 p-2 text-[11px] text-coral">
          Apply the Notion MCP database migration before connecting.
        </p>
      )}

      {status.connected && (
        <div className="mt-4 border-t border-hair pt-4">
          <label htmlFor="notion-sources" className="text-[11px] font-medium text-text-primary">Pages and databases to use as context</label>
          <p className="mt-1 text-[10px] text-text-tertiary">One Notion URL per line. Removing a URL removes that source from your Brain on the next sync.</p>
          <textarea id="notion-sources" value={sources} onChange={(event) => setSources(event.target.value)} rows={4}
            placeholder={'https://www.notion.so/your-workspace/Brand-voice-…\nhttps://www.notion.so/your-workspace/Customer-research-…'}
            className="mt-2 w-full resize-y rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-hover" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[10px] text-text-tertiary">
              {status.last_synced_at ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}` : 'Not synced yet'}
            </p>
            <button type="button" onClick={() => void sync()} disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-md bg-text-primary px-3 py-1.5 text-[11px] font-medium text-bg-primary hover:opacity-90 disabled:opacity-50">
              {busy === 'sync' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {busy === 'sync' ? 'Pulling context…' : 'Sync context'}
            </button>
          </div>
        </div>
      )}

      {(message || status.last_sync_error) && (
        <p className={`mt-3 text-[11px] ${(message?.type === 'success' && !status.last_sync_error) ? 'text-[#10B981]' : 'text-coral'}`}>
          {message?.text ?? status.last_sync_error}
        </p>
      )}
    </div>
  );
}
