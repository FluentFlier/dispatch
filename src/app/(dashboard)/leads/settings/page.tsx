'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import type { DirectorySettingsRow } from '@/lib/signals/types';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Lead settings: persistent config that isn't touched every session — digest
 * timing, timezone, delivery channels. ICP filters, source toggles, and the
 * watchlist live in the /leads Advanced drawer (no duplication).
 */
export default function LeadSettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<DirectorySettingsRow | null>(null);
  const [saving, setSaving] = useState(false);
  const detectedTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  useEffect(() => {
    void fetch('/api/leads/settings')
      .then((r) => r.json())
      .then((d) => setSettings(d.settings))
      .catch(() => toast('Could not load settings.', 'error'));
  }, [toast]);

  const patch = (p: Partial<DirectorySettingsRow>) =>
    setSettings((s) => (s ? { ...s, ...p } : s));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/leads/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          digest_run_hour_local: settings.digest_run_hour_local,
          digest_timezone: settings.digest_timezone || detectedTz,
          recency_window: settings.recency_window,
          digest_top_n: settings.digest_top_n,
          digest_channels: settings.digest_channels,
        }),
      });
      const data = await res.json();
      setSettings(data.settings);
      toast('Settings saved.');
    } catch {
      toast('Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="max-w-3xl mx-auto py-12 text-text-tertiary text-sm">Loading settings…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>
      <PageHeader eyebrow="LEADS" title="Lead settings" subtitle="Control when your morning list arrives and how it's delivered." />
      <p className="text-xs text-text-tertiary">
        Filters, sources & followed companies are in <span className="font-medium">Advanced</span> on the Leads page.
      </p>

      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-medium text-text-primary">Timing</h2>
        <label className="block text-sm text-text-secondary">
          Digest hour (local)
          <select
            value={settings.digest_run_hour_local}
            onChange={(e) => patch({ digest_run_hour_local: Number(e.target.value) })}
            className="mt-1 block w-40 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-text-secondary">
          Timezone
          <input
            value={settings.digest_timezone ?? detectedTz}
            onChange={(e) => patch({ digest_timezone: e.target.value })}
            className="mt-1 block w-full max-w-sm rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
          />
          <span className="text-xs text-text-tertiary">Detected as {detectedTz}. Your morning list is assembled at this local time.</span>
        </label>
        <label className="block text-sm text-text-secondary">
          Pre-draft top N
          <input
            type="number"
            min={0}
            max={100}
            value={settings.digest_top_n}
            onChange={(e) => patch({ digest_top_n: Number(e.target.value) })}
            className="mt-1 block w-28 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
          />
          <span className="text-xs text-text-tertiary">We pre-write the top N; the rest draft when you open them.</span>
        </label>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-medium text-text-primary">Delivery channels</h2>
        {(['today', 'slack', 'email'] as const).map((ch) => (
          <label key={ch} className="flex items-center gap-2 text-sm text-text-secondary capitalize">
            <input
              type="checkbox"
              disabled={ch === 'today'}
              checked={ch === 'today' ? true : settings.digest_channels?.[ch] ?? false}
              onChange={(e) => patch({ digest_channels: { ...settings.digest_channels, [ch]: e.target.checked } })}
            />
            {ch === 'today' ? 'Today tab (always on)' : `${ch} digest`}
          </label>
        ))}
      </Card>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={save} loading={saving}>Save</Button>
        <Link href="/leads"><Button variant="ghost" size="sm">Cancel</Button></Link>
      </div>
    </div>
  );
}
