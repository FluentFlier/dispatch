'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ComposioToolkit } from '@/lib/composio/config';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

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
  /** Revokes the grant at the provider, then clears the local row. */
  disconnect: () => Promise<void>;
  disconnecting: boolean;
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
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      // fetchWithAuth, not bare fetch: an expired access token 401s, and the
      // old code read `undefined` off the error body straight into
      // `Boolean(...)` = false, so a token that just needed refreshing showed a
      // connected account as "Not connected" until a manual reload.
      const res = await fetchWithAuth('/api/signals/integrations');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 401 / 400 (no active workspace) / 500 all land here. Surface it as an
        // error and leave the previous state alone - reporting a failed status
        // check as a disconnection is the bug, not the fix.
        setError(
          typeof data.error === 'string' ? data.error : 'Could not load integration status.',
        );
        return;
      }
      setError(null);
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

  /** Toolkit -> disconnect route. Calendar's path predates the others. */
  const DISCONNECT_PATH: Record<ComposioToolkit, string> = {
    googlecalendar: '/api/integrations/composio/calendar/disconnect',
    gmail: '/api/integrations/composio/gmail/disconnect',
    slack: '/api/integrations/composio/slack/disconnect',
  };

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetchWithAuth(DISCONNECT_PATH[toolkit], { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A 502 here means the provider could not be reached, so nothing was
        // revoked and nothing was cleared. Surfacing it matters: silently
        // showing "Not connected" would be a lie about a still-live grant.
        setError(
          typeof data.error === 'string' ? data.error : `Could not disconnect ${toolkit}.`,
        );
        return;
      }
      setConnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not disconnect ${toolkit}.`);
    } finally {
      setDisconnecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolkit]);

  return {
    disconnect,
    disconnecting,
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
