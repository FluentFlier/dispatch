'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ComposioToolkit } from '@/lib/composio/config';

interface IntegrationRow {
  toolkit: ComposioToolkit;
  connected: boolean;
  enabled: boolean;
}

interface UseComposioIntegrationResult {
  loading: boolean;
  connected: boolean;
  composioConfigured: boolean;
  toolkitReady: boolean;
  connecting: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  connect: (returnTo?: 'settings' | 'onboarding') => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Shared Composio connect/status hook for Settings integration cards.
 */
export function useComposioIntegration(
  toolkit: ComposioToolkit,
  refreshKey = 0,
): UseComposioIntegrationResult {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [composioConfigured, setComposioConfigured] = useState(false);
  const [toolkitReady, setToolkitReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/integrations');
      const data = await res.json();
      const row = (data.integrations as IntegrationRow[] | undefined)?.find(
        (i) => i.toolkit === toolkit,
      );
      setConnected(Boolean(row?.connected));
      setComposioConfigured(Boolean(data.composio_configured));
      const readyMap = data.toolkit_ready as Record<ComposioToolkit, boolean> | undefined;
      setToolkitReady(Boolean(readyMap?.[toolkit]));
    } catch {
      setError('Could not load integration status.');
    } finally {
      setLoading(false);
    }
  }, [toolkit]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, refreshKey]);

  const connect = useCallback(
    async (returnTo?: 'settings' | 'onboarding') => {
      if (!composioConfigured) {
        setError('Composio is not configured on this deployment.');
        return;
      }
      if (!toolkitReady) {
        setError(`${toolkit} auth is not configured on this deployment.`);
        return;
      }

      setConnecting(true);
      setError(null);

      try {
        if (toolkit === 'googlecalendar') {
          const qs = returnTo === 'settings' ? '?return=settings' : '';
          window.location.href = `/api/integrations/composio/connect${qs}`;
          return;
        }

        const returnParam = returnTo ? `&return=${returnTo}` : '&return=settings';
        const res = await fetch(
          `/api/integrations/composio/link?toolkit=${toolkit}${returnParam}`,
        );
        const data = await res.json();
        if (!res.ok || !data.redirect_url) {
          throw new Error(data.error ?? `Could not start ${toolkit} connect.`);
        }
        window.location.href = data.redirect_url as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not connect ${toolkit}.`);
        setConnecting(false);
      }
    },
    [composioConfigured, toolkit, toolkitReady],
  );

  return {
    loading,
    connected,
    composioConfigured,
    toolkitReady,
    connecting,
    error,
    setError,
    connect,
    reload: loadStatus,
  };
}
