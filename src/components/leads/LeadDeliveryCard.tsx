'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import type { DirectorySettingsRow } from '@/lib/signals/types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface LeadDeliveryCardProps {
  settings: DirectorySettingsRow;
  onSettingsSaved: (s: DirectorySettingsRow) => void;
  toast: (m: string, t?: 'success' | 'error') => void;
}

/**
 * "Delivery" - when the morning list is assembled and how it's delivered.
 * Folded in from the retired /leads/settings page so all lead configuration
 * lives on one Setup surface.
 */
export function LeadDeliveryCard({ settings, onSettingsSaved, toast }: LeadDeliveryCardProps) {
  const detectedTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const [draft, setDraft] = useState<DirectorySettingsRow>(settings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const patch = (p: Partial<DirectorySettingsRow>) => setDraft((s) => ({ ...s, ...p }));

  /** Human label for a per-channel skip reason from the digest endpoint. */
  const reasonLabel = (reason: string): string => {
    if (reason === 'sent') return 'sent';
    if (reason === 'channel_off') return 'channel off';
    if (reason === 'no_leads') return 'no leads today';
    if (reason === 'not_connected') return 'not connected';
    if (reason === 'no_channel_id') return 'no channel picked';
    if (reason === 'no_recipient') return 'no recipient email';
    if (reason === 'composio_off') return 'integrations not configured';
    if (reason.startsWith('send_failed')) return 'send failed';
    return reason;
  };

  /**
   * Fires the digest immediately (force/test mode) so the user can verify email
   * + Slack delivery without waiting for the hourly cron. Reports exactly why
   * each channel did or didn't send.
   */
  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetchWithAuth('/api/leads/digest/test', { method: 'POST', headers: jsonHeaders });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.result) {
        toast('Could not run test digest.', 'error');
        return;
      }
      const r = data.result as {
        count?: number;
        results?: { slack: { sent: boolean; reason: string }; email: { sent: boolean; reason: string } };
      };
      const email = r.results?.email;
      const slack = r.results?.slack;
      const parts = [
        `${r.count ?? 0} lead${r.count === 1 ? '' : 's'}`,
        email ? `email: ${reasonLabel(email.reason)}` : null,
        slack ? `slack: ${reasonLabel(slack.reason)}` : null,
      ].filter(Boolean);
      const anySent = Boolean(email?.sent || slack?.sent);
      toast(`Test digest - ${parts.join(' · ')}`, anySent ? 'success' : 'error');
    } catch {
      toast('Could not run test digest.', 'error');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/leads/settings', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({
          digest_run_hour_local: draft.digest_run_hour_local,
          digest_timezone: draft.digest_timezone || detectedTz,
          digest_top_n: draft.digest_top_n,
          digest_channels: draft.digest_channels,
          sender_identity: draft.sender_identity,
          scrape_frequency: draft.scrape_frequency ?? 'daily',
        }),
      });
      const data = await res.json().catch(() => ({}));
      // Guard: on a 4xx/5xx, data.settings is undefined - applying it blanked
      // the form and reported a false "saved". Keep the draft, surface the error.
      if (!res.ok || !data.settings) {
        toast('Could not save.', 'error');
        return;
      }
      setDraft(data.settings);
      onSettingsSaved(data.settings);
      toast('Delivery settings saved.');
    } catch {
      toast('Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-bg-secondary">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Delivery</h2>
        <p className="mt-0.5 text-xs text-text-secondary">
          When your morning list is assembled and where it lands.
        </p>
      </div>

      <div className="space-y-5 px-4 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-text-secondary">
            Digest hour (local)
            <select
              value={draft.digest_run_hour_local}
              onChange={(e) => patch({ digest_run_hour_local: Number(e.target.value) })}
              className="mt-1 block w-40 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-text-secondary">
            Pre-draft top N
            <input
              type="number"
              min={0}
              max={100}
              value={draft.digest_top_n}
              onChange={(e) => patch({ digest_top_n: Number(e.target.value) })}
              className="mt-1 block w-28 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-text-tertiary">We pre-write the top N; the rest draft when you open them.</span>
          </label>
        </div>

        <label className="block text-sm text-text-secondary">
          Scrape frequency
          <select
            value={draft.scrape_frequency ?? 'daily'}
            onChange={(e) => patch({ scrape_frequency: e.target.value as DirectorySettingsRow['scrape_frequency'] })}
            className="mt-1 block w-52 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
          >
            <option value="daily">Daily</option>
            <option value="every_3_days">Every 3 days</option>
            <option value="weekly">Weekly</option>
            <option value="manual">Manual only</option>
          </select>
          <span className="mt-1 block text-xs text-text-tertiary">
            How often we scrape for new leads automatically. Lower it to save credits; &quot;Manual
            only&quot; means leads arrive only when you hit Scrape or ask the assistant.
          </span>
        </label>

        <label className="block text-sm text-text-secondary">
          Timezone
          <input
            value={draft.digest_timezone ?? detectedTz}
            onChange={(e) => patch({ digest_timezone: e.target.value })}
            className="mt-1 block w-full max-w-sm rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-text-tertiary">Detected as {detectedTz}.</span>
        </label>

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">Channels</p>
          {(['today', 'slack', 'email'] as const).map((ch) => (
            <label
              key={ch}
              className="flex items-center gap-2 text-sm capitalize text-text-secondary"
              title={ch === 'today' ? 'The in-app Today tab is always on - it is where leads land.' : undefined}
            >
              <input
                type="checkbox"
                disabled={ch === 'today'}
                checked={ch === 'today' ? true : draft.digest_channels?.[ch] ?? false}
                onChange={(e) => patch({ digest_channels: { ...draft.digest_channels, [ch]: e.target.checked } })}
              />
              {ch === 'today' ? 'Today tab (always on)' : `${ch} digest`}
            </label>
          ))}
        </div>

        <label className="block text-sm text-text-secondary">
          Cold email footer (optional)
          <input
            value={draft.sender_identity ?? ''}
            onChange={(e) => patch({ sender_identity: e.target.value })}
            placeholder="Acme Inc, 1 Main St, San Francisco CA"
            className="mt-1 block w-full max-w-md rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-text-tertiary">
            Added to cold-email footers for CAN-SPAM/GDPR. Leave blank to send just the unsubscribe line.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => void save()} loading={saving}>Save delivery</Button>
          <Button variant="secondary" size="sm" onClick={() => void sendTest()} loading={testing}>
            Send test digest now
          </Button>
        </div>
        <p className="text-xs text-text-tertiary">
          Sends the digest right now to your enabled channels so you can verify email/Slack. Tick the
          channels above and connect Gmail/Slack in Advanced first.
        </p>
      </div>
    </section>
  );
}
