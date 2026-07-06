'use client';

import { Loader2 } from 'lucide-react';
import { useComposioIntegration } from '@/hooks/useComposioIntegration';

interface GmailConnectionCardProps {
  refreshKey?: number;
}

/**
 * Gmail connect card for Settings → Connections. Uses Composio OAuth and
 * powers voice import from sent email when connected.
 */
export default function GmailConnectionCard({ refreshKey = 0 }: GmailConnectionCardProps) {
  const {
    loading,
    connected,
    composioConfigured,
    toolkitReady,
    connecting,
    error,
    setError,
    connect,
  } = useComposioIntegration('gmail', refreshKey);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-secondary">
        <Loader2 size={14} className="animate-spin" /> Loading Gmail…
      </div>
    );
  }

  const showConfigWarning = !composioConfigured || !toolkitReady;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-7 h-7 rounded-[5px] flex items-center justify-center bg-accent-primary/10 text-accent-primary shrink-0 text-[11px] font-semibold">
          @
        </span>
        <span className="text-[13px] font-medium text-text-primary">Gmail</span>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-[3px] ${
            connected
              ? 'bg-[rgba(16,185,129,0.15)] text-[#10B981]'
              : 'bg-bg-tertiary text-text-secondary'
          }`}
        >
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <p className="text-[11px] text-text-secondary mb-3">
        Optional. Import sent-email voice samples and enrich your creator profile.
      </p>

      {showConfigWarning && (
        <div className="mb-3 rounded-lg border border-coral/30 bg-coral/5 p-3 text-[11px] text-coral">
          {!composioConfigured ? (
            <>
              Composio is not configured. Add <code className="text-[10px]">COMPOSIO_API_KEY</code> to hosting secrets.
            </>
          ) : (
            <>
              Gmail auth is not configured. Set{' '}
              <code className="text-[10px]">COMPOSIO_GMAIL_AUTH_CONFIG_ID</code>.
            </>
          )}
        </div>
      )}

      {!connected && (
        <button
          type="button"
          disabled={connecting || showConfigWarning}
          onClick={() => {
            setError(null);
            void connect('settings');
          }}
          className="inline-block px-4 py-2 text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors disabled:opacity-60"
        >
          {connecting ? 'Redirecting…' : 'Connect Gmail'}
        </button>
      )}

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
