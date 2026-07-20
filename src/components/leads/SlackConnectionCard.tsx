'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

interface SlackConfig {
  slack_channel_id?: string;
  slack_channel_name?: string;
  notify_on_new_signal?: boolean;
}

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackConnectionCardProps {
  /** Bumped after an OAuth connect returns, to re-pull status (Settings passes this). */
  refreshKey?: number;
}

/**
 * Slack delivery config for the Leads → Setup surface. Load-bearing fix for
 * "Slack is connected but nothing sends": until a channel is chosen here, every
 * Slack send (daily digest AND instant new-signal alert) hits an early return
 * because slack_channel_id was never set. Connect status + channel picker +
 * the instant-alert toggle all live here; the digest on/off checkboxes stay in
 * the Delivery card below.
 */
export function SlackConnectionCard({ refreshKey = 0 }: SlackConnectionCardProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [composioConfigured, setComposioConfigured] = useState(false);
  const [toolkitReady, setToolkitReady] = useState(false);
  const [config, setConfig] = useState<SlackConfig>({});
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * Revokes the Slack grant at Composio, then clears the local row. A 502 means
   * the provider could not be reached and NOTHING was revoked, so we keep
   * showing "Connected" - claiming otherwise would hide a still-live grant.
   */
  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetchWithAuth('/api/integrations/composio/slack/disconnect', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(typeof data.error === 'string' ? data.error : 'Could not disconnect Slack.', 'error');
        return;
      }
      setConnected(false);
      setEnabled(false);
      setChannels([]);
      toast('Slack disconnected.');
    } catch {
      toast('Could not disconnect Slack.', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/signals/integrations');
      const data = await res.json();
      const row = (data.integrations as Array<{ toolkit: string; connected: boolean; enabled: boolean; config: SlackConfig }> | undefined)?.find(
        (i) => i.toolkit === 'slack',
      );
      setConnected(Boolean(row?.connected));
      setEnabled(Boolean(row?.enabled));
      setConfig(row?.config ?? {});
      setComposioConfigured(Boolean(data.composio_configured));
      setToolkitReady(Boolean((data.toolkit_ready as Record<string, boolean> | undefined)?.slack));
    } catch {
      toast('Could not load Slack status.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, refreshKey]);

  // Fetch the channel list only once Slack is actually connected + enabled.
  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    try {
      const res = await fetchWithAuth('/api/signals/integrations/slack/channels');
      const data = await res.json();
      if (res.ok) setChannels(data.channels ?? []);
      else toast(data.error ?? 'Could not load channels.', 'error');
    } catch {
      toast('Could not load channels.', 'error');
    } finally {
      setChannelsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (connected && enabled) void loadChannels();
  }, [connected, enabled, loadChannels]);

  const connect = async () => {
    if (!composioConfigured) return toast('Composio is not configured on this deployment.', 'error');
    if (!toolkitReady) return toast('Slack auth is not configured on this deployment.', 'error');
    setConnecting(true);
    try {
      const res = await fetchWithAuth('/api/integrations/composio/link?toolkit=slack&return=settings');
      const data = await res.json();
      if (!res.ok || !data.redirect_url) throw new Error(data.error ?? 'Could not start Slack connect.');
      window.location.href = data.redirect_url as string;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not connect Slack.', 'error');
      setConnecting(false);
    }
  };

  const patch = async (body: SlackConfig, successMsg: string) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/signals/integrations', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ toolkit: 'slack', ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save.');
      setConfig((c) => ({ ...c, ...body }));
      toast(successMsg);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onSelectChannel = (id: string) => {
    const name = channels.find((c) => c.id === id)?.name;
    void patch({ slack_channel_id: id, slack_channel_name: name }, name ? `Alerts will post to #${name}.` : 'Channel saved.');
  };

  const notifyOn = config.notify_on_new_signal !== false; // default on

  return (
    <section className="rounded-lg border border-border bg-bg-secondary">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Slack alerts</h2>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-[3px] ${
            connected ? 'bg-[rgba(16,185,129,0.15)] text-[#10B981]' : 'bg-bg-tertiary text-text-secondary'
          }`}
        >
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="space-y-4 px-4 py-4">
        {loading ? (
          <p className="text-xs text-text-tertiary">Loading Slack…</p>
        ) : !composioConfigured || !toolkitReady ? (
          <p className="text-xs text-coral">
            {!composioConfigured
              ? 'Composio is not configured. Add COMPOSIO_API_KEY to hosting secrets.'
              : 'Slack auth is not configured. Set COMPOSIO_SLACK_AUTH_CONFIG_ID.'}
          </p>
        ) : !connected ? (
          <>
            <p className="text-xs text-text-secondary">
              Connect Slack to get your daily lead digest and instant alerts when a company raises a round or changes leadership.
            </p>
            <button
              type="button"
              disabled={connecting}
              onClick={() => void connect()}
              className="inline-block px-4 py-2 text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors disabled:opacity-60"
            >
              {connecting ? 'Redirecting…' : 'Connect Slack'}
            </button>
          </>
        ) : (
          <>
            <label className="block text-sm text-text-secondary">
              Post alerts to
              <select
                value={config.slack_channel_id ?? ''}
                disabled={channelsLoading || saving}
                onChange={(e) => onSelectChannel(e.target.value)}
                className="mt-1 block w-full max-w-sm rounded-md border border-border bg-bg-primary px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="" disabled>
                  {channelsLoading ? 'Loading channels…' : 'Select a channel'}
                </option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
              {!config.slack_channel_id && !channelsLoading && (
                <span className="mt-1 block text-xs text-coral">
                  Pick a channel - until you do, no Slack message is sent.
                </span>
              )}
            </label>

            <label className="flex items-start gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={notifyOn}
                disabled={saving}
                onChange={(e) =>
                  void patch(
                    { notify_on_new_signal: e.target.checked },
                    e.target.checked ? 'Instant alerts on.' : 'Instant alerts off.',
                  )
                }
                className="mt-0.5"
              />
              <span>
                Instant alert on crucial signals
                <span className="mt-0.5 block text-xs text-text-tertiary">
                  Pings the channel the moment a watched company raises a round, changes an investor, or has a leadership change. Small edits are ignored.
                </span>
              </span>
            </label>

            <button
              type="button"
              disabled={disconnecting}
              onClick={() => setConfirmOpen(true)}
              className="inline-block rounded-md border border-border px-4 py-2 text-[12px] text-text-secondary transition-colors hover:border-coral/40 hover:text-coral disabled:opacity-60"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect Slack'}
            </button>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Disconnect Slack"
        message="This revokes Content OS's access to your Slack workspace. The daily lead digest and instant signal alerts will stop until you reconnect."
        confirmLabel="Disconnect"
        tone="danger"
        loading={disconnecting}
        onConfirm={() => {
          setConfirmOpen(false);
          void disconnect();
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </section>
  );
}
