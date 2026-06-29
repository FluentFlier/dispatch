'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Mail, Calendar } from 'lucide-react';

type OutreachToolkit = 'gmail' | 'googlecalendar';

interface IntegrationRow {
  toolkit: OutreachToolkit;
  connected: boolean;
}

const TOOLKIT_META: Record<
  OutreachToolkit,
  { label: string; description: string; icon: typeof Mail }
> = {
  gmail: {
    label: 'Gmail',
    description: 'Send outreach emails from Signals.',
    icon: Mail,
  },
  googlecalendar: {
    label: 'Google Calendar',
    description: 'Schedule follow-ups from Signals.',
    icon: Calendar,
  },
};

export default function OutreachConnections() {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<OutreachToolkit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/signals/integrations', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setConfigured(data.composio_configured !== false);
      const rows = (data.integrations ?? []) as Array<{ toolkit: string; connected: boolean }>;
      setIntegrations(
        (['gmail', 'googlecalendar'] as const).map((toolkit) => ({
          toolkit,
          connected: Boolean(rows.find((r) => r.toolkit === toolkit)?.connected),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect(toolkit: OutreachToolkit) {
    setConnecting(toolkit);
    try {
      const res = await fetch(`/api/integrations/composio/link?toolkit=${toolkit}`, {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect_url) {
        window.location.href = data.redirect_url as string;
        return;
      }
    } finally {
      setConnecting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading outreach connections…
      </div>
    );
  }

  if (!configured) {
    return (
      <p className="text-sm text-text-secondary">
        Email and calendar sending are managed by your workspace admin.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {integrations.map(({ toolkit, connected }) => {
        const meta = TOOLKIT_META[toolkit];
        const Icon = meta.icon;
        return (
          <div
            key={toolkit}
            className="rounded-lg border border-border bg-bg-primary p-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-bg-tertiary text-text-secondary">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-text-primary">{meta.label}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">{meta.description}</p>
                </div>
              </div>
              {connected && (
                <span className="inline-flex items-center gap-1 text-xs text-accent-secondary">
                  <Check className="h-3.5 w-3.5" />
                  Connected
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={connecting !== null}
              onClick={() => connect(toolkit)}
              className="text-sm font-medium text-accent-primary hover:underline disabled:opacity-50 text-left"
            >
              {connecting === toolkit ? 'Opening…' : connected ? 'Reconnect' : 'Connect'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
