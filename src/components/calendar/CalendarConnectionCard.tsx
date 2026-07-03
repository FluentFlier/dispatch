"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, RefreshCw, Unplug } from "lucide-react";
import { RELOAD_PRESETS, resolveWindow, type WindowRequest } from "@/lib/event-capture/window";

interface IntegrationStatus {
  toolkit: 'slack' | 'gmail' | 'googlecalendar';
  connected: boolean;
  enabled: boolean;
}

interface ResyncResponse {
  created?: number;
  updated?: number;
  cancelled?: number;
  enriched?: number;
  message?: string;
  error?: string;
}

/**
 * Shared Google Calendar connect + manual reload card. Fetches its own status so
 * it can be dropped into Settings, Dashboard, and Signals unchanged. Disconnected
 * → connect link; connected → window picker + reload with explicit result/errors
 * surfaced so the user can self-diagnose configuration problems.
 */
export default function CalendarConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [preset, setPreset] = useState<WindowRequest['preset']>('last_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [reloading, setReloading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/integrations');
      const data = await res.json();
      const cal = (data.integrations as IntegrationStatus[] | undefined)?.find((i) => i.toolkit === 'googlecalendar');
      setConnected(Boolean(cal?.connected));
    } catch {
      setError('Could not load calendar status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function handleReload() {
    setReloading(true);
    setResult(null);
    setError(null);
    try {
      if (preset === 'custom' && (!customFrom || !customTo)) {
        setError('Pick both a start and end date for a custom range.');
        return;
      }
      const req: WindowRequest =
        preset === 'custom' ? { preset, from: customFrom, to: customTo } : { preset };
      const { timeMin, timeMax } = resolveWindow(req, new Date());
      const res = await fetch('/api/integrations/composio/calendar/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() }),
      });
      const data: ResyncResponse = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Reload failed.');
      } else {
        setResult(data.message ?? 'Reload complete.');
      }
    } catch {
      setError('Network error during reload.');
    } finally {
      setReloading(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/integrations/composio/calendar/disconnect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Disconnect failed.');
      } else {
        setConnected(false);
      }
    } catch {
      setError('Network error during disconnect.');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-secondary">
        <Loader2 size={14} className="animate-spin" /> Loading calendar…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-7 h-7 rounded-[5px] flex items-center justify-center bg-accent-primary/10 text-accent-primary shrink-0">
          <CalendarDays size={16} />
        </span>
        <span className="text-[13px] font-medium text-text-primary">Google Calendar</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-[3px] ${connected ? 'bg-[rgba(16,185,129,0.15)] text-[#10B981]' : 'bg-bg-tertiary text-text-secondary'}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
        {connected && (
          <button
            type="button"
            disabled={disconnecting}
            onClick={handleDisconnect}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 text-[11px] text-text-tertiary border border-border rounded-[6px] hover:border-border-hover transition-colors disabled:opacity-60"
          >
            <Unplug size={12} />
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </div>

      {!connected ? (
        <a
          href="/api/integrations/composio/connect"
          className="inline-block px-4 py-2 text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors"
        >
          Connect Google Calendar
        </a>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-text-secondary">
            Reimport events for a window. This overwrites imported events with a fresh copy.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as WindowRequest['preset'])}
              className="bg-bg-tertiary border border-border rounded-md px-3 py-2 text-[12px] text-text-primary"
            >
              {RELOAD_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {preset === 'custom' && (
              <>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-bg-tertiary border border-border rounded-md px-2 py-2 text-[12px] text-text-primary" />
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-bg-tertiary border border-border rounded-md px-2 py-2 text-[12px] text-text-primary" />
              </>
            )}
            <button
              type="button"
              disabled={reloading}
              onClick={handleReload}
              className="px-4 py-2 text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 disabled:opacity-60 flex items-center gap-2 transition-colors"
            >
              {reloading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {reloading ? 'Reloading…' : 'Reload'}
            </button>
          </div>
          {result && <p className="text-[11px] text-[#10B981]">{result}</p>}
          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
