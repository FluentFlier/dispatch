"use client";

import { useState } from "react";
import { CalendarDays, Loader2, RefreshCw, Unplug } from "lucide-react";
import { RELOAD_PRESETS, resolveWindow, type WindowRequest } from "@/lib/event-capture/window";
import { useComposioIntegration } from "@/hooks/useComposioIntegration";

interface ResyncResponse {
  created?: number;
  updated?: number;
  cancelled?: number;
  enriched?: number;
  message?: string;
  error?: string;
}

interface CalendarConnectionCardProps {
  /** Bump to reload connection status after OAuth redirect. */
  refreshKey?: number;
  /** Render a small status pill (label + connect/disconnect) instead of the full
   *  reimport card. Used in the Settings integrations list where the window/reload
   *  controls don't belong. */
  compact?: boolean;
}

/**
 * Shared Google Calendar connect + manual reload card. Fetches its own status so
 * it can be dropped into Settings, Dashboard, and Signals unchanged. Disconnected
 * → connect button; connected → window picker + reload with explicit result/errors
 * surfaced so the user can self-diagnose configuration problems.
 */
export default function CalendarConnectionCard({ refreshKey = 0, compact = false }: CalendarConnectionCardProps) {
  const {
    loading,
    connected,
    composioConfigured,
    toolkitReady,
    connecting,
    error,
    setError,
    connect,
    reload,
  } = useComposioIntegration('googlecalendar', refreshKey);

  const [preset, setPreset] = useState<WindowRequest['preset']>('last_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [reloading, setReloading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleReload() {
    setReloading(true);
    setResult(null);
    setLocalError(null);
    try {
      if (preset === 'custom' && (!customFrom || !customTo)) {
        setLocalError('Pick both a start and end date for a custom range.');
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
        setLocalError(data.error ?? 'Reload failed.');
      } else {
        setResult(data.message ?? 'Reload complete.');
      }
    } catch {
      setLocalError('Network error during reload.');
    } finally {
      setReloading(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setResult(null);
    setLocalError(null);
    try {
      const res = await fetch('/api/integrations/composio/calendar/disconnect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLocalError(data.error ?? 'Disconnect failed.');
      } else {
        await reload();
      }
    } catch {
      setLocalError('Network error during disconnect.');
    } finally {
      setDisconnecting(false);
    }
  }

  const showConfigWarning = !composioConfigured || !toolkitReady;

  // Compact pill for the Settings integrations list: status + connect/disconnect,
  // no window/reload controls (those live on the full card in the calendar view).
  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-bg-primary px-3 py-2 text-xs">
        <span className="font-medium text-text-primary">Google Calendar</span>
        {loading ? (
          <Loader2 size={14} className="animate-spin text-text-secondary" />
        ) : connected ? (
          <button
            type="button"
            disabled={disconnecting}
            onClick={handleDisconnect}
            className="text-text-tertiary hover:underline disabled:opacity-60"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            disabled={connecting || showConfigWarning}
            onClick={() => {
              setError(null);
              void connect('settings');
            }}
            className="font-medium text-accent-primary hover:underline disabled:opacity-60"
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    );
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

      {showConfigWarning && (
        <div className="mb-3 rounded-lg border border-coral/30 bg-coral/5 p-3 text-[11px] text-coral">
          {!composioConfigured ? (
            <>
              Composio is not configured. Add <code className="text-[10px]">COMPOSIO_API_KEY</code> to hosting secrets.
            </>
          ) : (
            <>
              Google Calendar auth is not configured. Set{' '}
              <code className="text-[10px]">COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID</code>.
            </>
          )}
        </div>
      )}

      {!connected ? (
        <button
          type="button"
          disabled={connecting || showConfigWarning}
          onClick={() => {
            setError(null);
            void connect('settings');
          }}
          className="inline-block px-4 py-2 text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors disabled:opacity-60"
        >
          {connecting ? 'Redirecting…' : 'Connect Google Calendar'}
        </button>
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
        </div>
      )}
      {(error || localError) && (
        <p className="mt-2 text-[11px] text-red-400">{error ?? localError}</p>
      )}
    </div>
  );
}
